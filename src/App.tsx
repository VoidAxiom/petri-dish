import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  createDefaultBrowserPersistedRunStore,
  type BrowserPersistedRunLoadResult,
  type BrowserRunStorageBackend,
  type StorageHealth
} from "./persistence/browserRunStore";
import {
  applyOfflineCatchUp,
  buildEventImpactReports,
  buildLineageAtlas,
  createWorld,
  createGenerationSnapshot,
  defaultSnapshotInterval,
  explainCreaturePressure,
  loadPersistedRun,
  nearestGenerationSnapshot,
  genomeKeys,
  planOfflineCatchUp,
  selectLineageRepresentative,
  snapshotWorld,
  speciesColor,
  stepWorld,
  upsertGenerationSnapshot,
  type Creature,
  type CreaturePressureReport,
  type EventImpactReport,
  type GenerationSnapshot,
  type Genome,
  type LineageAtlasEntry,
  type OfflineCatchUpPlan,
  type SimulationEvent,
  type TerrainCell,
  type World
} from "./simulation";

const demoSeeds = ["mythic-lagoon-17", "glass-drought-41", "ember-reef-93"];
const mapModes = ["terrain", "food", "disease", "predators", "temperature"] as const;
const simulationTickMs = 420;
const epochSteps = 50;
const epochChunkSteps = 5;
const maxReplaySnapshots = 80;
const persistenceSaveInterval = 5;
const maxPersistedReplaySnapshots = 2;
const biomeColors: Record<TerrainCell["biome"], string> = {
  mire: "#166534",
  steppe: "#5f6f32",
  reef: "#0f766e",
  fungal: "#7c3aed",
  basalt: "#334155",
  ice: "#7dd3fc"
};

type MapMode = (typeof mapModes)[number];
type CanvasSize = { width: number; height: number };
type CreatureRecord = { creature: Creature; status: "living" | "dead" };
type TerrainCanvasCache = { key: string; canvas: HTMLCanvasElement };
type PersistenceUiState = {
  status: "loading" | "fresh" | "restored" | "saved" | "cleared" | "unavailable" | "invalid" | "unsupported" | "error";
  savedAt?: string;
  generation?: number;
  bytes?: number;
  manifestBytes?: number;
  backend?: BrowserRunStorageBackend;
  storageHealth?: StorageHealth;
  reason?: string;
  catchUp?: OfflineCatchUpPlan;
};
type InitialRunState = {
  seed: string;
  world: World;
  detailWorld: World;
  snapshots: GenerationSnapshot[];
  selectedId?: string;
  replayGeneration?: number;
  persistence: PersistenceUiState;
  autosaveEnabled: boolean;
  running: boolean;
  persistedSignature?: string;
  persistOnLoad?: boolean;
};
type WorldIndex = {
  creatureById: Map<string, Creature>;
  graveyardById: Map<string, Creature>;
  livingByLineage: Map<string, Creature[]>;
  deadByLineage: Map<string, Creature[]>;
  eventsByLineage: Map<string, SimulationEvent[]>;
};

function loadInitialRunState(): InitialRunState {
  if (browserHasIndexedDb()) {
    return createFreshInitialRun({ status: "loading", reason: "opening-local-run", backend: "indexeddb" }, false, false);
  }

  const storage = browserLocalStorage();
  if (!storage) {
    return createFreshInitialRun({ status: "unavailable", reason: "local-storage-unavailable" }, false);
  }

  const result: BrowserPersistedRunLoadResult = { ...loadPersistedRun(storage), backend: "local-storage" };
  return initialRunFromLoadResult(result, false);
}

function initialRunFromLoadResult(result: BrowserPersistedRunLoadResult, persistOnLoadAfterRestore: boolean): InitialRunState {
  if (result.status === "loaded") {
    const payload = result.payload;
    const catchUp = planOfflineCatchUp(payload.savedAt);
    const restoredWorld = applyOfflineCatchUp(payload.world, catchUp);
    const restoredSnapshots = restoreSnapshotsForRun(payload.snapshots, restoredWorld);
    const replayGeneration = restoredReplayGeneration(restoredSnapshots, payload.replayGeneration);
    const selectionSnapshot = replayGeneration === undefined ? undefined : nearestGenerationSnapshot(restoredSnapshots, replayGeneration);
    const selectedId = restoredSelectedId(selectionSnapshot?.world ?? restoredWorld, payload.selectedCreatureId);

    return {
      seed: restoredWorld.seed,
      world: restoredWorld,
      detailWorld: restoredWorld,
      snapshots: restoredSnapshots,
      selectedId,
      replayGeneration,
      persistence: {
        status: "restored",
        savedAt: payload.savedAt,
        generation: restoredWorld.generation,
        bytes: result.bytes,
        manifestBytes: result.manifestBytes,
        backend: result.backend,
        storageHealth: result.storageHealth,
        catchUp
      },
      autosaveEnabled: true,
      running: true,
      persistedSignature:
        catchUp.generations > 0 || persistOnLoadAfterRestore
          ? undefined
          : persistedRunSignature(restoredWorld, snapshotsForPersistence(restoredWorld, restoredSnapshots, replayGeneration), selectedId, replayGeneration),
      persistOnLoad: catchUp.generations > 0 || persistOnLoadAfterRestore
    };
  }

  if (result.status === "missing") {
    return createFreshInitialRun({ status: "fresh", backend: result.backend }, true);
  }

  if (result.status === "unsupported") {
    return createFreshInitialRun({ status: "unsupported", reason: result.reason, backend: result.backend }, false);
  }

  return createFreshInitialRun({ status: result.status, reason: result.reason, backend: result.backend }, false);
}

function createFreshInitialRun(persistence: PersistenceUiState, autosaveEnabled: boolean, running = true): InitialRunState {
  const world = createWorld(demoSeeds[0]);
  return {
    seed: world.seed,
    world,
    detailWorld: world,
    snapshots: [createGenerationSnapshot(world)],
    selectedId: world.creatures[0]?.id,
    persistence,
    autosaveEnabled,
    running
  };
}

function browserLocalStorage() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function browserHasIndexedDb(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.indexedDB);
  } catch {
    return false;
  }
}

function restoredReplayGeneration(snapshots: GenerationSnapshot[], generation?: number): number | undefined {
  if (generation === undefined) return undefined;
  return nearestGenerationSnapshot(snapshots, generation)?.generation;
}

function restoredSelectedId(world: World, selectedId?: string): string | undefined {
  if (selectedId && world.creatures.some((creature) => creature.id === selectedId)) {
    return selectedId;
  }
  return world.creatures[0]?.id;
}

function persistedRunSignature(world: World, snapshots: GenerationSnapshot[], selectedId?: string, replayGeneration?: number): string {
  const latestSnapshot = snapshots.at(-1);
  return [world.seed, world.generation, snapshots.length, latestSnapshot?.generation ?? "none", selectedId ?? "none", replayGeneration ?? "live"].join(":");
}

function snapshotsForPersistence(world: World, snapshots: GenerationSnapshot[], replayGeneration?: number): GenerationSnapshot[] {
  const retained = new Map<number, GenerationSnapshot>();
  const replaySnapshot = replayGeneration === undefined ? undefined : nearestGenerationSnapshot(snapshots, replayGeneration);
  if (replaySnapshot && replaySnapshot.generation !== world.generation) {
    retained.set(replaySnapshot.generation, replaySnapshot);
  }

  for (const snapshot of snapshots.filter((item) => item.generation !== world.generation).slice(-maxPersistedReplaySnapshots)) {
    retained.set(snapshot.generation, snapshot);
  }

  return [...retained.values()].sort((left, right) => left.generation - right.generation);
}

function restoreSnapshotsForRun(snapshots: GenerationSnapshot[], world: World): GenerationSnapshot[] {
  const current = createGenerationSnapshot(world);
  return [...snapshots.filter((snapshot) => snapshot.generation !== current.generation), current]
    .sort((left, right) => left.generation - right.generation)
    .slice(-maxReplaySnapshots);
}

export default function App() {
  const [initialRun] = useState(loadInitialRunState);
  const persistenceStore = useMemo(createDefaultBrowserPersistedRunStore, []);
  const [seed, setSeed] = useState(initialRun.seed);
  const [world, setWorld] = useState(initialRun.world);
  const [running, setRunning] = useState(initialRun.running);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialRun.selectedId);
  const [debug, setDebug] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("terrain");
  const [epoching, setEpoching] = useState(false);
  const [detailWorld, setDetailWorld] = useState(initialRun.detailWorld);
  const [snapshots, setSnapshots] = useState<GenerationSnapshot[]>(initialRun.snapshots);
  const [replayGeneration, setReplayGeneration] = useState<number | undefined>(initialRun.replayGeneration);
  const [persistence, setPersistence] = useState<PersistenceUiState>(initialRun.persistence);
  const [autosaveEnabled, setAutosaveEnabled] = useState(initialRun.autosaveEnabled);
  const lastFrameTick = useRef<number | undefined>(undefined);
  const epochRunId = useRef(0);
  const persistenceRequestId = useRef(0);
  const persistenceWriteChain = useRef<Promise<unknown>>(Promise.resolve());
  const lastPersistedSignature = useRef<string | undefined>(initialRun.persistedSignature);
  const persistOnLoad = useRef(initialRun.persistOnLoad ?? false);
  const replaySnapshot = useMemo(
    () => (replayGeneration === undefined ? undefined : nearestGenerationSnapshot(snapshots, replayGeneration)),
    [replayGeneration, snapshots]
  );
  const replayWorld = useMemo(() => (replaySnapshot ? snapshotWorld(replaySnapshot) : undefined), [replaySnapshot]);
  const viewWorld = replayWorld ?? world;
  const detailSourceWorld = replayWorld ?? detailWorld;
  const viewWorldIndex = useMemo(() => buildWorldIndex(viewWorld), [viewWorld]);
  const detailWorldIndex = useMemo(() => buildWorldIndex(detailSourceWorld), [detailSourceWorld]);
  const isReplayMode = Boolean(replayWorld);
  const selectedCreature = useMemo(
    () => (selectedId ? viewWorldIndex.creatureById.get(selectedId) : undefined) ?? viewWorld.creatures[0],
    [selectedId, viewWorld.creatures, viewWorldIndex]
  );
  const detailSelectedCreature = useMemo(
    () => (selectedId ? detailWorldIndex.creatureById.get(selectedId) : undefined) ?? detailSourceWorld.creatures[0],
    [detailSourceWorld.creatures, detailWorldIndex, selectedId]
  );
  const selectedLineageCount = selectedCreature ? (viewWorldIndex.livingByLineage.get(selectedCreature.lineageId)?.length ?? 0) : 0;
  const latest = viewWorld.summaries.at(-1)!;

  useEffect(() => {
    if (persistence.status !== "loading") return;
    if (!persistenceStore) {
      applyRunState(createFreshInitialRun({ status: "unavailable", reason: "browser-storage-unavailable" }, false));
      return;
    }

    let cancelled = false;
    const requestId = ++persistenceRequestId.current;
    persistenceStore.load().then((result) => {
      if (cancelled || requestId !== persistenceRequestId.current) return;
      const shouldMigrateToIndexedDb = result.status === "loaded" && result.backend === "local-storage" && persistenceStore.preferredBackend === "indexeddb";
      applyRunState(initialRunFromLoadResult(result, shouldMigrateToIndexedDb));
    });

    return () => {
      cancelled = true;
    };
  }, [persistence.status, persistenceStore]);

  useEffect(() => {
    if (!running) {
      lastFrameTick.current = undefined;
      return;
    }

    let frameId = 0;
    const animate = (time: number) => {
      if (lastFrameTick.current === undefined) {
        lastFrameTick.current = time;
      }

      if (time - lastFrameTick.current >= simulationTickMs) {
        lastFrameTick.current = time;
        setWorld((current) => stepWorld(current));
      }
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      lastFrameTick.current = undefined;
    };
  }, [running]);

  useEffect(() => {
    setSnapshots((current) => upsertGenerationSnapshot(current, world, defaultSnapshotInterval, maxReplaySnapshots));
  }, [world]);

  useEffect(() => {
    if (!running || world.generation % 5 === 0 || world.generation - detailWorld.generation >= 5) {
      setDetailWorld(world);
    }
  }, [detailWorld.generation, running, world]);

  useEffect(() => {
    if (isReplayMode) {
      return;
    }
    if (!selectedId || detailWorldIndex.creatureById.has(selectedId)) {
      return;
    }
    setDetailWorld(world);
  }, [detailWorldIndex, isReplayMode, selectedId, world]);

  useEffect(() => {
    if (!autosaveEnabled) return;
    if (persistOnLoad.current) {
      persistOnLoad.current = false;
      persistCurrentRun();
      return;
    }
    if (world.generation !== 0 && world.generation % persistenceSaveInterval !== 0) return;
    persistCurrentRun();
  }, [autosaveEnabled, replayGeneration, selectedId, snapshots, world]);

  function reset(nextSeed = seed) {
    epochRunId.current += 1;
    const nextWorld = createWorld(nextSeed);
    const nextSnapshots = [createGenerationSnapshot(nextWorld)];
    const nextSelectedId = nextWorld.creatures[0]?.id;
    setSeed(nextSeed);
    setWorld(nextWorld);
    setDetailWorld(nextWorld);
    setSnapshots(nextSnapshots);
    setReplayGeneration(undefined);
    setSelectedId(nextSelectedId);
    setEpoching(false);
    setAutosaveEnabled(true);
    persistRun(nextWorld, nextSnapshots, nextSelectedId, undefined, undefined);
  }

  function advanceStep() {
    setWorld((current) => stepWorld(current));
  }

  function advanceEpoch() {
    if (epoching) return;
    const runId = epochRunId.current + 1;
    epochRunId.current = runId;
    setRunning(false);
    setEpoching(true);
    let remaining = epochSteps;

    const advanceChunk = () => {
      if (epochRunId.current !== runId) return;
      const steps = Math.min(epochChunkSteps, remaining);
      setWorld((current) => {
        let next = current;
        for (let index = 0; index < steps; index += 1) {
          next = stepWorld(next);
        }
        return next;
      });
      remaining -= steps;

      if (remaining > 0) {
        window.setTimeout(advanceChunk, 0);
      } else {
        setEpoching(false);
      }
    };

    window.setTimeout(advanceChunk, 0);
  }

  function selectReplaySnapshot(generation: number) {
    const snapshot = nearestGenerationSnapshot(snapshots, generation);
    if (snapshot) {
      setReplayGeneration(snapshot.generation);
    }
  }

  function moveReplaySnapshot(offset: number) {
    const currentIndex = snapshots.findIndex((snapshot) => snapshot.generation === replaySnapshot?.generation);
    const fallbackIndex = snapshots.length - 1;
    const nextIndex = Math.max(0, Math.min(snapshots.length - 1, (currentIndex >= 0 ? currentIndex : fallbackIndex) + offset));
    const snapshot = snapshots[nextIndex];
    if (snapshot) {
      setReplayGeneration(snapshot.generation);
    }
  }

  function persistCurrentRun() {
    persistRun(world, snapshots, selectedId, replayGeneration, persistence.catchUp);
  }

  function persistRun(
    nextWorld: World,
    nextSnapshots: GenerationSnapshot[],
    nextSelectedId?: string,
    nextReplayGeneration?: number,
    catchUp?: OfflineCatchUpPlan
  ) {
    if (!persistenceStore) {
      setAutosaveEnabled(false);
      setPersistence({ status: "unavailable", reason: "browser-storage-unavailable" });
      return;
    }

    const persistedSnapshots = snapshotsForPersistence(nextWorld, nextSnapshots, nextReplayGeneration);
    const signature = persistedRunSignature(nextWorld, persistedSnapshots, nextSelectedId, nextReplayGeneration);
    if (lastPersistedSignature.current === signature) {
      return;
    }

    const requestId = ++persistenceRequestId.current;
    enqueuePersistenceWrite(() =>
      persistenceStore.save({
        world: nextWorld,
        snapshots: persistedSnapshots,
        selectedCreatureId: nextSelectedId,
        replayGeneration: nextReplayGeneration
      })
    ).then((result) => {
      if (requestId !== persistenceRequestId.current) return;

      if (result.status === "saved") {
        lastPersistedSignature.current = signature;
        setPersistence({
          status: "saved",
          savedAt: result.savedAt,
          generation: nextWorld.generation,
          bytes: result.bytes,
          manifestBytes: result.manifestBytes,
          backend: result.backend,
          storageHealth: result.storageHealth,
          catchUp
        });
        return;
      }

      setAutosaveEnabled(false);
      setPersistence({
        status: "error",
        generation: nextWorld.generation,
        reason: result.reason,
        backend: result.backend
      });
    });
  }

  function clearSavedRun() {
    if (!persistenceStore) {
      setAutosaveEnabled(false);
      setPersistence({ status: "unavailable", reason: "browser-storage-unavailable" });
      return;
    }

    const requestId = ++persistenceRequestId.current;
    setAutosaveEnabled(false);
    lastPersistedSignature.current = undefined;
    enqueuePersistenceWrite(() => persistenceStore.clear()).then((result) => {
      if (requestId !== persistenceRequestId.current) return;
      setPersistence(
        result.status === "cleared"
          ? { status: "cleared", backend: result.backend }
          : { status: "error", generation: world.generation, reason: result.reason, backend: result.backend }
      );
    });
  }

  function enqueuePersistenceWrite<Result>(operation: () => Promise<Result>): Promise<Result> {
    const write = persistenceWriteChain.current.catch(() => undefined).then(operation);
    persistenceWriteChain.current = write.then(
      () => undefined,
      () => undefined
    );
    return write;
  }

  function saveNow() {
    setAutosaveEnabled(true);
    persistCurrentRun();
  }

  function applyRunState(next: InitialRunState) {
    epochRunId.current += 1;
    setSeed(next.seed);
    setWorld(next.world);
    setDetailWorld(next.detailWorld);
    setSnapshots(next.snapshots);
    setReplayGeneration(next.replayGeneration);
    setSelectedId(next.selectedId);
    setEpoching(false);
    setAutosaveEnabled(next.autosaveEnabled);
    setRunning(next.running);
    setPersistence(next.persistence);
    lastPersistedSignature.current = next.persistedSignature;
    persistOnLoad.current = next.persistOnLoad ?? false;
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Deterministic civilization lab</p>
          <h1>Petri Dish</h1>
        </div>
        <div className="control-row">
          <select id="world-seed" name="world-seed" value={seed} onChange={(event) => reset(event.target.value)} aria-label="Seed">
            {demoSeeds.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setRunning((value) => !value)}>
            {running ? "Pause" : "Run"}
          </button>
          <button type="button" onClick={advanceStep}>
            Step
          </button>
          <button type="button" onClick={advanceEpoch} disabled={epoching}>
            {epoching ? "Epoching" : "Epoch"}
          </button>
          <button type="button" onClick={() => reset()}>
            Reset
          </button>
          <label className="toggle">
            <input name="debug-overlay" type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
            Debug
          </label>
          <PersistenceStatus state={persistence} autosaveEnabled={autosaveEnabled} onClear={clearSavedRun} onSaveNow={saveNow} />
        </div>
      </section>

      <section className="lab-grid">
        <div className="map-stage">
          <div className="map-toolbar" aria-label="Map mode">
            <div className="map-mode-buttons">
              {mapModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={mode === mapMode ? "active" : ""}
                  aria-pressed={mode === mapMode}
                  onClick={() => setMapMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <MapLegend mode={mapMode} />
          </div>
          <WorldMap
            world={viewWorld}
            liveGeneration={world.generation}
            replayGeneration={replaySnapshot?.generation}
            replayMode={isReplayMode}
            selectedId={selectedCreature?.id}
            selectedLineageId={selectedCreature?.lineageId}
            selectedLineageCount={selectedLineageCount}
            debug={debug}
            mode={mapMode}
            onSelect={setSelectedId}
          />
          <ReplayPanel
            snapshots={snapshots}
            liveWorld={world}
            replaySnapshot={replaySnapshot}
            replayMode={isReplayMode}
            onSelect={selectReplaySnapshot}
            onPrevious={() => moveReplaySnapshot(-1)}
            onNext={() => moveReplaySnapshot(1)}
            onLive={() => setReplayGeneration(undefined)}
          />
          <div className="event-strip">
            <div>
              <strong data-testid="display-generation">Generation {viewWorld.generation}</strong>
              <span>{viewWorld.currentEvent ? `${viewWorld.currentEvent.name} (${viewWorld.currentEvent.remaining})` : "No active catastrophe"}</span>
            </div>
            <div>
              <strong>{latest.population}</strong>
              <span>living agents</span>
            </div>
            <div>
              <strong>{latest.species}</strong>
              <span>species</span>
            </div>
            <div>
              <strong>{latest.dominantTrait}</strong>
              <span>dominant trait</span>
            </div>
          </div>

          <section className="dashboard-grid">
            <Metric label="Food" value={latest.averageFood} tone="green" />
            <Metric label="Disease" value={latest.averageDisease} tone="red" />
            <Metric label="Predators" value={latest.averagePredatorPressure} tone="amber" />
            <Metric label="Diversity" value={latest.diversity} tone="cyan" />
            <Metric label="Fitness" value={latest.averageFitness} tone="violet" />
          </section>

          <section className="lower-grid">
            <MemoTimeline world={detailSourceWorld} />
            <MemoAftermathPanel world={detailSourceWorld} />
            <MemoWorldMemory world={detailSourceWorld} />
          </section>
        </div>

        <aside className="side-panel">
          <MemoCreatureInspector creature={detailSelectedCreature} world={detailSourceWorld} />
          <MemoDynastyPanel creature={detailSelectedCreature} world={detailSourceWorld} index={detailWorldIndex} />
          <MemoLineageAtlasPanel
            world={detailSourceWorld}
            selectionWorld={viewWorld}
            selectedLineageId={detailSelectedCreature?.lineageId}
            onSelect={setSelectedId}
          />
          <MemoSpeciesPanel world={detailSourceWorld} />
        </aside>
      </section>
    </main>
  );
}

function buildWorldIndex(world: World): WorldIndex {
  const creatureById = new Map<string, Creature>();
  const graveyardById = new Map<string, Creature>();
  const livingByLineage = new Map<string, Creature[]>();
  const deadByLineage = new Map<string, Creature[]>();
  const eventsByLineage = new Map<string, SimulationEvent[]>();

  for (const creature of world.creatures) {
    creatureById.set(creature.id, creature);
    pushMapList(livingByLineage, creature.lineageId, creature);
  }

  for (const creature of world.graveyard) {
    graveyardById.set(creature.id, creature);
    pushMapList(deadByLineage, creature.lineageId, creature);
  }

  for (const event of world.events) {
    if (event.lineageId) {
      pushMapList(eventsByLineage, event.lineageId, event);
    }
  }

  return { creatureById, graveyardById, livingByLineage, deadByLineage, eventsByLineage };
}

function pushMapList<T>(map: Map<string, T[]>, key: string, item: T): void {
  const list = map.get(key);
  if (list) {
    list.push(item);
  } else {
    map.set(key, [item]);
  }
}

function PersistenceStatus({
  state,
  autosaveEnabled,
  onClear,
  onSaveNow
}: {
  state: PersistenceUiState;
  autosaveEnabled: boolean;
  onClear: () => void;
  onSaveNow: () => void;
}) {
  const canClear = ["fresh", "restored", "saved", "invalid", "unsupported"].includes(state.status);
  const actionLabel = canClear ? "Clear save" : "Save now";
  const action = canClear ? onClear : onSaveNow;
  const actionDisabled = state.status === "loading";

  return (
    <div
      className={`persistence-status persistence-status-${state.status}`}
      data-testid="persistence-status"
      data-status={state.status}
      data-autosave={autosaveEnabled ? "enabled" : "paused"}
      data-generation={state.generation ?? ""}
      data-bytes={state.bytes ?? ""}
      data-manifest-bytes={state.manifestBytes ?? ""}
      data-backend={state.backend ?? ""}
      data-storage-health={state.storageHealth ?? ""}
      data-catch-up-generations={state.catchUp?.generations ?? ""}
      data-catch-up-capped={state.catchUp?.capped ? "true" : "false"}
      data-catch-up-elapsed-ms={state.catchUp?.elapsedMs ?? ""}
    >
      <div>
        <p className="eyebrow">Local run</p>
        <strong>{persistenceStatusLabel(state)}</strong>
        <span>{persistenceStatusDetail(state, autosaveEnabled)}</span>
      </div>
      <button type="button" onClick={action} disabled={actionDisabled}>
        {actionLabel}
      </button>
    </div>
  );
}

function persistenceStatusLabel(state: PersistenceUiState): string {
  if (state.status === "loading") return "Opening run";
  if (state.status === "restored") return `Restored g${state.generation ?? 0}`;
  if (state.status === "saved") return `Saved g${state.generation ?? 0}`;
  if (state.status === "cleared") return "Save cleared";
  if (state.status === "invalid") return "Save invalid";
  if (state.status === "unsupported") return "Save outdated";
  if (state.status === "unavailable") return "Storage unavailable";
  if (state.status === "error") return "Save failed";
  return "Fresh run";
}

function persistenceStatusDetail(state: PersistenceUiState, autosaveEnabled: boolean): string {
  if (state.catchUp && state.catchUp.generations > 0) {
    const capLabel = state.catchUp.capped ? " capped" : "";
    return `${backendLabel(state.backend)} · caught up ${state.catchUp.generations}g${capLabel} after ${formatElapsed(state.catchUp.elapsedMs)} away`;
  }
  if (state.savedAt) return `${backendLabel(state.backend)} · ${formatSavedAt(state.savedAt)} · ${autosaveEnabled ? "autosave on" : "saving paused"}`;
  if (state.reason) return state.reason;
  return `${backendLabel(state.backend)} · ${autosaveEnabled ? "autosave on" : "saving paused"}`;
}

function backendLabel(backend?: BrowserRunStorageBackend): string {
  if (backend === "indexeddb") return "IndexedDB";
  if (backend === "local-storage") return "localStorage";
  return "local";
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "saved time unknown";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function WorldMap({
  world,
  liveGeneration,
  replayGeneration,
  replayMode,
  selectedId,
  selectedLineageId,
  selectedLineageCount,
  debug,
  mode,
  onSelect
}: {
  world: World;
  liveGeneration: number;
  replayGeneration?: number;
  replayMode: boolean;
  selectedId?: string;
  selectedLineageId?: string;
  selectedLineageCount: number;
  debug: boolean;
  mode: MapMode;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCanvasCache = useRef<TerrainCanvasCache | undefined>(undefined);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize((current) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        return current.width === width && current.height === height ? current : { width, height };
      });
    };

    syncSize();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(syncSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    drawWorldMap(context, canvas, terrainCanvasCache, canvasSize, world, mode, selectedId, selectedLineageId, selectedLineageCount, debug);
  }, [canvasSize, debug, mode, selectedId, selectedLineageCount, selectedLineageId, world]);

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * world.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * world.height);
    let nearest: Creature | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const creature of world.creatures) {
      const distance = Math.hypot(creature.x - x, creature.y - y);
      if (distance < nearestDistance) {
        nearest = creature;
        nearestDistance = distance;
      }
    }

    if (nearest) {
      onSelect(nearest.id);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="world-map"
      role="img"
      aria-label="Living simulation map"
      data-testid="world-map"
      data-generation={world.generation}
      data-live-generation={liveGeneration}
      data-replay-generation={replayGeneration ?? ""}
      data-replay-mode={replayMode ? "snapshot" : "live"}
      data-terrain-cells={world.cells.length}
      data-creatures-rendered={world.creatures.length}
      data-selected-lineage-count={selectedLineageCount}
      data-selected-lineage-id={selectedLineageId ?? ""}
      data-map-mode={mode}
      onClick={handleClick}
    />
  );
}

function drawWorldMap(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  terrainCanvasCache: MutableRefObject<TerrainCanvasCache | undefined>,
  canvasSize: CanvasSize,
  world: World,
  mode: MapMode,
  selectedId: string | undefined,
  selectedLineageId: string | undefined,
  selectedLineageCount: number,
  debug: boolean
): void {
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(canvasSize.width * pixelRatio));
  const pixelHeight = Math.max(1, Math.round(canvasSize.height * pixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, canvasSize.width, canvasSize.height);

  const cellWidth = canvasSize.width / world.width;
  const cellHeight = canvasSize.height / world.height;
  const radiusBase = Math.min(cellWidth, cellHeight);

  if (mode === "terrain") {
    drawCachedTerrainLayer(context, terrainCanvasCache, canvasSize, world, pixelRatio, cellWidth, cellHeight);
    drawTerrainVitalityLayer(context, world, cellWidth, cellHeight);
  } else {
    for (const cell of world.cells) {
      context.globalAlpha = cellOpacity(cell, mode);
      context.fillStyle = cellFill(cell, mode) ?? biomeColors[cell.biome];
      context.fillRect(cell.x * cellWidth, cell.y * cellHeight, cellWidth + 0.35, cellHeight + 0.35);
    }
  }

  if (debug) {
    for (const cell of world.cells) {
      if (cell.disease <= 0.55 && cell.predatorPressure <= 0.55) continue;
      context.globalAlpha = 0.48;
      context.fillStyle = cell.disease > cell.predatorPressure ? "#ef4444" : "#f97316";
      context.beginPath();
      context.arc((cell.x + 0.5) * cellWidth, (cell.y + 0.5) * cellHeight, radiusBase * (cell.disease > cell.predatorPressure ? 0.22 : 0.32), 0, Math.PI * 2);
      context.fill();
    }
  }

  for (const creature of world.creatures) {
    const isSelected = creature.id === selectedId;
    const isLineage = selectedLineageCount > 0 && creature.lineageId === selectedLineageId;
    context.globalAlpha = selectedLineageId && !isLineage ? 0.72 : 1;
    context.fillStyle = speciesColor(creature.speciesId);
    context.strokeStyle = isSelected ? "#ffffff" : isLineage ? "#fde68a" : "rgba(255,255,255,0.22)";
    context.lineWidth = isSelected ? 2.1 : isLineage ? 1.45 : 0.75;
    context.beginPath();
    context.arc(
      (creature.x + 0.5) * cellWidth,
      (creature.y + 0.5) * cellHeight,
      radiusBase * (isSelected ? 0.62 : isLineage ? 0.48 + creature.energy * 0.08 : 0.34 + creature.energy * 0.08),
      0,
      Math.PI * 2
    );
    context.fill();
    context.stroke();
  }

  context.globalAlpha = 1;
}

function drawTerrainVitalityLayer(context: CanvasRenderingContext2D, world: World, cellWidth: number, cellHeight: number): void {
  for (const cell of world.cells) {
    const stress = Math.max(cell.disease * 0.5, cell.predatorPressure * 0.42);
    const foodGlow = cell.food * 0.22;
    context.globalAlpha = Math.max(0.06, foodGlow + stress);
    context.fillStyle = stress > foodGlow ? "rgba(239, 68, 68, 0.42)" : "rgba(132, 204, 22, 0.34)";
    context.fillRect(cell.x * cellWidth, cell.y * cellHeight, cellWidth + 0.35, cellHeight + 0.35);
  }

  context.globalAlpha = 1;
}

function drawCachedTerrainLayer(
  context: CanvasRenderingContext2D,
  terrainCanvasCache: MutableRefObject<TerrainCanvasCache | undefined>,
  canvasSize: CanvasSize,
  world: World,
  pixelRatio: number,
  cellWidth: number,
  cellHeight: number
): void {
  const cacheKey = `${world.seed}:${world.width}x${world.height}:${canvasSize.width}x${canvasSize.height}:${pixelRatio}`;
  let cache = terrainCanvasCache.current;

  if (!cache || cache.key !== cacheKey) {
    const terrainCanvas = document.createElement("canvas");
    terrainCanvas.width = Math.max(1, Math.round(canvasSize.width * pixelRatio));
    terrainCanvas.height = Math.max(1, Math.round(canvasSize.height * pixelRatio));
    const terrainContext = terrainCanvas.getContext("2d");

    if (terrainContext) {
      terrainContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      for (const cell of world.cells) {
        terrainContext.globalAlpha = terrainCellOpacity(cell);
        terrainContext.fillStyle = biomeColors[cell.biome];
        terrainContext.fillRect(cell.x * cellWidth, cell.y * cellHeight, cellWidth + 0.35, cellHeight + 0.35);
      }
      terrainContext.globalAlpha = 1;
    }

    cache = { key: cacheKey, canvas: terrainCanvas };
    terrainCanvasCache.current = cache;
  }

  context.globalAlpha = 1;
  context.drawImage(cache.canvas, 0, 0, canvasSize.width, canvasSize.height);
}

function ReplayPanel({
  snapshots,
  liveWorld,
  replaySnapshot,
  replayMode,
  onSelect,
  onPrevious,
  onNext,
  onLive
}: {
  snapshots: GenerationSnapshot[];
  liveWorld: World;
  replaySnapshot?: GenerationSnapshot;
  replayMode: boolean;
  onSelect: (generation: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onLive: () => void;
}) {
  const first = snapshots[0];
  const latest = snapshots.at(-1);
  const selected = replaySnapshot ?? latest;
  const selectedIndex = snapshots.findIndex((snapshot) => snapshot.generation === selected?.generation);
  const selectedSummary = selected?.summary ?? liveWorld.summaries.at(-1)!;

  return (
    <section
      className={`replay-panel ${replayMode ? "replay-panel-active" : ""}`}
      data-testid="snapshot-panel"
      data-replay-mode={replayMode ? "snapshot" : "live"}
      data-live-generation={liveWorld.generation}
      data-snapshot-generation={replaySnapshot?.generation ?? ""}
    >
      <div className="replay-status">
        <div>
          <p className="eyebrow">Replay lens</p>
          <strong data-testid="snapshot-generation">{replayMode ? `Generation ${selected?.generation ?? liveWorld.generation}` : "Live"}</strong>
        </div>
        <div>
          <span>current run</span>
          <strong data-testid="live-generation">Generation {liveWorld.generation}</strong>
        </div>
        <div>
          <span>checkpoint</span>
          <strong>
            {selectedIndex + 1}/{snapshots.length}
          </strong>
        </div>
        <div>
          <span>population</span>
          <strong data-testid="snapshot-population">{selectedSummary.population}</strong>
        </div>
      </div>

      <div className="replay-controls">
        <button type="button" onClick={onLive} disabled={!replayMode} data-testid="replay-live-toggle">
          Live
        </button>
        <button type="button" onClick={onPrevious} disabled={snapshots.length <= 1 || selectedIndex <= 0}>
          Previous
        </button>
        <input
          id="replay-generation"
          name="replay-generation"
          type="range"
          min={first?.generation ?? 0}
          max={latest?.generation ?? liveWorld.generation}
          step={defaultSnapshotInterval}
          value={selected?.generation ?? liveWorld.generation}
          aria-label="Replay generation"
          data-testid="snapshot-scrubber"
          onInput={(event) => onSelect(Number(event.currentTarget.value))}
          onChange={(event) => onSelect(Number(event.currentTarget.value))}
        />
        <button type="button" onClick={onNext} disabled={snapshots.length <= 1 || selectedIndex >= snapshots.length - 1}>
          Next
        </button>
      </div>
    </section>
  );
}

function MapLegend({ mode }: { mode: MapMode }) {
  if (mode === "terrain") {
    return (
      <div className="map-legend terrain-legend" aria-label="Terrain legend">
        {["mire", "steppe", "reef", "fungal", "basalt", "ice"].map((biome) => (
          <span key={biome}>
            <i className={`terrain-${biome}`} />
            {biome}
          </span>
        ))}
      </div>
    );
  }

  const labels: Record<Exclude<MapMode, "terrain">, [string, string]> = {
    food: ["scarce", "abundant"],
    disease: ["clean", "infected"],
    predators: ["safe", "hunted"],
    temperature: ["cold", "hot"]
  };

  return (
    <div className={`map-legend pressure-legend pressure-legend-${mode}`} aria-label={`${mode} legend`}>
      <span>{labels[mode][0]}</span>
      <i />
      <span>{labels[mode][1]}</span>
    </div>
  );
}

function CreatureInspector({ creature, world }: { creature?: Creature; world: World }) {
  if (!creature) {
    return <section className="panel">No surviving creatures.</section>;
  }

  const cell = world.cells[creature.y * world.width + creature.x];
  const pressure = explainCreaturePressure(creature, cell, world.currentEvent, world.creatures.length);

  return (
    <section
      className="panel inspector"
      data-testid="creature-inspector"
      data-generation={world.generation}
      data-creature-id={creature.id}
      data-lineage-id={creature.lineageId}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected organism</p>
          <h2>{creature.name}</h2>
        </div>
        <span className="species-chip" style={{ borderColor: speciesColor(creature.speciesId), color: speciesColor(creature.speciesId) }}>
          {creature.speciesId}
        </span>
      </div>
      <div className="fact-grid">
        <Fact label="Energy" value={creature.energy.toFixed(2)} />
        <Fact label="Age" value={creature.age} />
        <Fact label="Fitness" value={creature.fitness.toFixed(2)} />
        <Fact label="Births" value={creature.births} />
        <Fact label="Biome" value={cell.biome} />
        <Fact label="Lineage" value={creature.lineageId} />
      </div>
      <SurvivalPressurePanel pressure={pressure} />
      <GenomeBars genome={creature.genome} />
      <div className="ancestry">
        <p className="eyebrow">Ancestry</p>
        <p>{creature.parentIds.length ? creature.parentIds.join(" x ") : "founder generation"}</p>
        <p>{creature.mutations.length ? `${creature.mutations.length} mutations in this genome` : "no recorded mutations"}</p>
      </div>
    </section>
  );
}

function SurvivalPressurePanel({ pressure }: { pressure: CreaturePressureReport }) {
  return (
    <div className="survival-pressure">
      <div className="survival-heading">
        <div>
          <p className="eyebrow">Survival pressures</p>
          <strong>Primary risk: {pressure.primaryRisk}</strong>
        </div>
        <span>fitness {pressure.estimatedFitness.toFixed(2)}</span>
      </div>
      <div className="survival-summary">
        <Fact label="Projected energy" value={pressure.projectedEnergy.toFixed(2)} />
        <Fact label="Stress cost" value={pressure.costs.total.toFixed(2)} />
        <Fact label="Breed ready" value={`${Math.round(pressure.reproductionReadiness * 100)}%`} />
      </div>
      <div className="pressure-list">
        {pressure.metrics.map((metric) => (
          <div key={metric.kind} className={`pressure-row pressure-row-${metric.kind}`}>
            <div className="pressure-row-top">
              <strong>{metric.label}</strong>
              <span>{Math.round(metric.value * 100)}%</span>
            </div>
            <div className="pressure-bar" aria-label={`${metric.label} pressure`}>
              <i style={{ width: `${Math.round(metric.value * 100)}%` }} />
            </div>
            <p>{metric.detail}</p>
            <small>
              {metric.trait}: {metric.traitValue.toFixed(2)}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function DynastyPanel({ creature, world, index }: { creature?: Creature; world: World; index: WorldIndex }) {
  if (!creature) {
    return <section className="panel">No dynasty selected.</section>;
  }

  const cell = world.cells[creature.y * world.width + creature.x];
  const livingLineage = index.livingByLineage.get(creature.lineageId) ?? [];
  const archivedLineage = index.deadByLineage.get(creature.lineageId) ?? [];
  const allLineage = [...livingLineage, ...archivedLineage];
  const parentNames = creature.parentIds.map((id) => creatureName(id, index));
  const lineageEvents = (index.eventsByLineage.get(creature.lineageId) ?? [])
    .filter((event) => event.creatureId === creature.id || event.parentIds?.includes(creature.id) || event.lineageId === creature.lineageId)
    .slice(-6)
    .reverse();
  const mutationTrail = allLineage.flatMap((candidate) =>
    candidate.mutations.map((mutation) => ({
      creature: candidate.name,
      ...mutation
    }))
  );
  const averageFitness =
    livingLineage.reduce((sum, candidate) => sum + candidate.fitness, 0) / Math.max(1, livingLineage.length);
  const totalBirths = allLineage.reduce((sum, candidate) => sum + candidate.births, 0);
  const speciesTouched = new Set(allLineage.map((candidate) => candidate.speciesId)).size;

  return (
    <section
      className="panel dynasty-panel"
      data-testid="dynasty-panel"
      data-generation={world.generation}
      data-lineage-id={creature.lineageId}
      data-living={livingLineage.length}
      data-dead={archivedLineage.length}
      data-total-births={totalBirths}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Dynasty</p>
          <h2>{creature.lineageId}</h2>
        </div>
        <span className="lineage-badge">{livingLineage.length} living</span>
      </div>

      <div className="fact-grid dynasty-facts">
        <Fact label="Archived dead" value={archivedLineage.length} />
        <Fact label="Total births" value={totalBirths} />
        <Fact label="Avg fitness" value={averageFitness.toFixed(2)} />
        <Fact label="Species touched" value={speciesTouched} />
        <Fact label="Mutations" value={mutationTrail.length} />
        <Fact label="Ancestors" value={creature.ancestorIds.length || "founder"} />
      </div>

      <div className="lineage-thread">
        <p className="eyebrow">Parentage</p>
        <strong>{parentNames.length ? parentNames.join(" x ") : "founder generation"}</strong>
        <span>
          age {creature.age} · born generation {creature.generation} · {creature.births} direct births
        </span>
      </div>

      <LineageLens creature={creature} world={world} index={index} />

      <div className="pressure-grid">
        <div>
          <span>Food</span>
          <strong>{cell.food.toFixed(2)}</strong>
        </div>
        <div>
          <span>Disease</span>
          <strong>{cell.disease.toFixed(2)}</strong>
        </div>
        <div>
          <span>Predators</span>
          <strong>{cell.predatorPressure.toFixed(2)}</strong>
        </div>
      </div>

      <MiniLedger
        title="Mutation trail"
        empty="no inherited mutations recorded"
        items={mutationTrail.slice(-5).reverse().map((mutation) => ({
          key: `${mutation.creature}-${mutation.generation}-${mutation.gene}-${mutation.delta}`,
          label: `g${mutation.generation}`,
          text: `${mutation.creature} shifted ${mutation.gene} by ${mutation.delta}`
        }))}
      />

      <MiniLedger
        title="Recent lineage events"
        empty="no recent lineage events"
        items={lineageEvents.map((event) => ({
          key: event.id,
          label: `g${event.generation}`,
          text: event.message
        }))}
      />
    </section>
  );
}

function LineageLens({ creature, world, index }: { creature: Creature; world: World; index: WorldIndex }) {
  const relatives = lineageRelatives(creature, index);
  const species = world.species.find((item) => item.id === creature.speciesId);
  const parentGenomes = creature.parentIds
    .map((id) => findCreatureRecord(id, index)?.creature.genome)
    .filter((genome): genome is Genome => Boolean(genome));
  const parentAverage = averageGenomes(parentGenomes);
  const speciesDeltas = species ? topGenomeDeltas(creature.genome, species.averageGenome, 4) : [];
  const parentDeltas = parentAverage ? topGenomeDeltas(creature.genome, parentAverage, 3) : [];

  return (
    <div className="lineage-lens">
      <div className="lineage-lens-heading">
        <div>
          <p className="eyebrow">Lineage lens</p>
          <strong>{relatives.length} tracked relatives</strong>
        </div>
        <span>{index.livingByLineage.get(creature.lineageId)?.length ?? 0} alive on map</span>
      </div>
      <div className="family-thread" aria-label="Lineage family thread">
        {relatives.map((relative) => (
          <div key={`${relative.role}-${relative.creature.id}`} className={`family-node family-node-${relative.status}`}>
            <strong>{relative.creature.name}</strong>
            <span>
              {relative.role} · {relative.status} · g{relative.creature.generation}
            </span>
          </div>
        ))}
      </div>
      <div className="genome-compare">
        <GenomeDeltaList title="Species drift" items={speciesDeltas} empty="no species baseline yet" />
        <GenomeDeltaList title="Parent drift" items={parentDeltas} empty="founder genome has no parent baseline" />
      </div>
    </div>
  );
}

function GenomeDeltaList({
  title,
  items,
  empty
}: {
  title: string;
  items: Array<{ gene: keyof Genome; delta: number; value: number; baseline: number }>;
  empty: string;
}) {
  return (
    <div className="delta-list">
      <p className="eyebrow">{title}</p>
      {items.length ? (
        items.map((item) => (
          <div key={`${title}-${item.gene}`} className="delta-row">
            <strong>{item.gene}</strong>
            <span className={item.delta >= 0 ? "delta-positive" : "delta-negative"}>
              {item.delta >= 0 ? "+" : ""}
              {item.delta.toFixed(2)}
            </span>
            <small>
              {item.value.toFixed(2)} vs {item.baseline.toFixed(2)}
            </small>
          </div>
        ))
      ) : (
        <p className="quiet">{empty}</p>
      )}
    </div>
  );
}

function GenomeBars({ genome }: { genome: Genome }) {
  return (
    <div className="genome-bars">
      {genomeKeys.map((key) => (
        <div key={key} className="gene-row">
          <span>{key}</span>
          <div>
            <i style={{ width: `${Math.round(genome[key] * 100)}%` }} />
          </div>
          <b>{genome[key].toFixed(2)}</b>
        </div>
      ))}
    </div>
  );
}

function SpeciesPanel({ world }: { world: World }) {
  return (
    <section className="panel species-panel" data-testid="species-panel" data-generation={world.generation}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Clans and species</p>
          <h2>Survivors</h2>
        </div>
      </div>
      <div className="species-list">
        {world.species.slice(0, 8).map((species) => (
          <div key={species.id} className="species-row">
            <span className="swatch" style={{ background: species.color }} />
            <div>
              <strong>{species.id}</strong>
              <small>
                {species.population} alive · {species.lineageCount} dynasties · {species.dominantBiome}
              </small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LineageAtlasPanel({
  world,
  selectionWorld,
  selectedLineageId,
  onSelect
}: {
  world: World;
  selectionWorld: World;
  selectedLineageId?: string;
  onSelect: (id: string) => void;
}) {
  const atlas = useMemo(() => buildLineageAtlas(world, { limit: 8 }), [world]);
  const selectionCreatureIds = useMemo(
    () => new Map(atlas.map((lineage) => [lineage.lineageId, selectLineageRepresentative(selectionWorld.creatures, lineage.lineageId)?.id])),
    [atlas, selectionWorld.creatures]
  );

  return (
    <section className="panel lineage-atlas-panel" data-testid="lineage-atlas-panel" data-generation={world.generation}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Lineage atlas</p>
          <h2>Dominant dynasties</h2>
        </div>
      </div>
      <div className="lineage-atlas-list">
        {atlas.map((lineage) => (
          <LineageAtlasRow
            key={lineage.lineageId}
            lineage={lineage}
            selectionCreatureId={selectionCreatureIds.get(lineage.lineageId)}
            selected={lineage.lineageId === selectedLineageId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function LineageAtlasRow({
  lineage,
  selectionCreatureId,
  selected,
  onSelect
}: {
  lineage: LineageAtlasEntry;
  selectionCreatureId?: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const disabled = !selectionCreatureId;

  return (
    <button
      type="button"
      className={`lineage-atlas-row ${selected ? "active" : ""}`}
      disabled={disabled}
      data-testid="lineage-atlas-row"
      data-lineage-id={lineage.lineageId}
      data-living={lineage.living}
      data-dead={lineage.dead}
      data-survival-score={lineage.survivalScore}
      data-representative-creature-id={selectionCreatureId ?? ""}
      onClick={() => {
        if (selectionCreatureId) {
          onSelect(selectionCreatureId);
        }
      }}
    >
      <span className="lineage-atlas-top">
        <strong>{lineage.lineageId}</strong>
        <b>{lineage.survivalScore.toFixed(1)}</b>
      </span>
      <span className="lineage-atlas-meta">
        {lineage.living} living · {lineage.dead} archived · {lineage.births} births
      </span>
      <span className="lineage-atlas-traits">
        {lineage.speciesCount} species · {lineage.mutationCount} mutations · {lineage.dominantTrait}
      </span>
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value.toFixed(2)}</strong>
    </div>
  );
}

function Timeline({ world }: { world: World }) {
  const points = world.summaries.slice(-80);
  const maxPopulation = Math.max(1, ...points.map((point) => point.population));
  const firstGeneration = points[0]?.generation ?? 0;
  const generationSpan = Math.max(1, (points.at(-1)?.generation ?? firstGeneration) - firstGeneration);
  const ledgerMarkers = world.events
    .filter((event) => event.kind === "catastrophe" || event.kind === "extinction" || event.kind === "speciation")
    .filter((event) => event.generation >= firstGeneration)
    .slice(-36);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 48 - (point.population / maxPopulation) * 42;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <section
      className="panel timeline-panel"
      data-testid="population-timeline"
      data-generation-min={firstGeneration}
      data-generation-max={points.at(-1)?.generation ?? firstGeneration}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Population curve</p>
          <h2>Selection pressure</h2>
        </div>
      </div>
      <svg className="timeline" viewBox="0 0 100 52" preserveAspectRatio="none">
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {ledgerMarkers.map((event) => {
          const x = ((event.generation - firstGeneration) / generationSpan) * 100;
          return (
            <circle
              key={event.id}
              cx={x}
              cy={event.kind === "catastrophe" ? 8 : event.kind === "extinction" ? 44 : 18}
              r={event.kind === "catastrophe" ? 1.7 : 1.2}
              fill={eventColor(event.kind)}
              opacity="0.88"
            />
          );
        })}
        {points.map((point, index) =>
          point.event ? (
            <line
              key={`${point.generation}-${point.event.name}`}
              x1={(index / Math.max(1, points.length - 1)) * 100}
              x2={(index / Math.max(1, points.length - 1)) * 100}
              y1="4"
              y2="50"
              stroke="#f97316"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          ) : null
        )}
      </svg>
    </section>
  );
}

function AftermathPanel({ world }: { world: World }) {
  const impacts = useMemo(() => buildEventImpactReports(world, { maxReports: 3 }), [world]);
  const impact = impacts[0];

  if (!impact) {
    return (
      <section className="panel aftermath-panel" data-testid="aftermath-panel" data-event-generation="">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Aftermath</p>
            <h2>No major shock window yet</h2>
          </div>
        </div>
        <p className="quiet">Catastrophe and extinction impacts will appear after the world accumulates enough history.</p>
      </section>
    );
  }

  const population = impact.metrics.find((metric) => metric.key === "population")!;
  const food = impact.metrics.find((metric) => metric.key === "food")!;
  const disease = impact.metrics.find((metric) => metric.key === "disease")!;
  const predators = impact.metrics.find((metric) => metric.key === "predators")!;

  return (
    <section
      className="panel aftermath-panel"
      data-testid="aftermath-panel"
      data-event-generation={impact.generation}
      data-window-start={impact.beforeGeneration}
      data-window-end={impact.afterGeneration}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Aftermath</p>
          <h2>{impact.kind === "catastrophe" ? impact.eventKind : "extinction cluster"}</h2>
        </div>
        <span className={`event-kind event-kind-${impact.kind === "catastrophe" ? "catastrophe" : "extinction"}`}>
          g{impact.generation}
        </span>
      </div>

      <p className="aftermath-headline">{impact.headline}</p>
      <div className="aftermath-window" data-testid="aftermath-window">
        g{impact.beforeGeneration}
        {" -> "}
        g{impact.afterGeneration}
        {impact.severity ? ` · severity ${impact.severity}` : ""}
      </div>

      <div className="aftermath-grid">
        <AftermathStat label="Population delta" value={signed(population.delta)} testId="aftermath-population-delta" />
        <AftermathStat label="Deaths" value={impact.windowDeaths} testId="aftermath-deaths" />
        <AftermathStat label="Extinctions" value={impact.extinctionCount} testId="aftermath-extinctions" />
      </div>

      <div className="aftermath-pressure" data-testid="aftermath-pressure-delta">
        <ImpactDelta metric={food} />
        <ImpactDelta metric={disease} />
        <ImpactDelta metric={predators} />
      </div>

      <MiniLedger
        title="Extinctions in window"
        empty="no species disappeared in this window"
        items={impact.extinctions.slice(0, 4).map((speciesId) => ({
          key: speciesId,
          label: "lost",
          text: speciesId
        }))}
      />
    </section>
  );
}

function AftermathStat({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

function ImpactDelta({ metric }: { metric: EventImpactReport["metrics"][number] }) {
  return (
    <div className="impact-delta">
      <span>{metric.label}</span>
      <strong className={metric.delta >= 0 ? "delta-positive" : "delta-negative"}>{signed(metric.delta)}</strong>
      <small>
        {metric.before.toFixed(2)}
        {" -> "}
        {metric.after.toFixed(2)}
      </small>
    </div>
  );
}

function WorldMemory({ world }: { world: World }) {
  const events = world.events.slice(-10).reverse();

  return (
    <section className="panel" data-testid="world-memory" data-generation={world.generation}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Event ledger</p>
          <h2>World memory</h2>
        </div>
      </div>
      <div className="log-list">
        {events.length ? (
          events.map((event) => (
            <div key={event.id} className="log-row">
              <strong>Gen {event.generation}</strong>
              <span className={`event-kind event-kind-${event.kind}`}>{event.kind}</span>
              <span>{event.message}</span>
            </div>
          ))
        ) : (
          <p className="quiet">No causal events recorded yet.</p>
        )}
      </div>
    </section>
  );
}

const MemoCreatureInspector = memo(CreatureInspector);
const MemoDynastyPanel = memo(DynastyPanel);
const MemoLineageAtlasPanel = memo(LineageAtlasPanel);
const MemoSpeciesPanel = memo(SpeciesPanel);
const MemoTimeline = memo(Timeline);
const MemoAftermathPanel = memo(AftermathPanel);
const MemoWorldMemory = memo(WorldMemory);

function MiniLedger({
  title,
  empty,
  items
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; label: string; text: string }>;
}) {
  return (
    <div className="mini-ledger">
      <p className="eyebrow">{title}</p>
      {items.length ? (
        items.map((item) => (
          <div key={item.key} className="mini-ledger-row">
            <strong>{item.label}</strong>
            <span>{item.text}</span>
          </div>
        ))
      ) : (
        <p className="quiet">{empty}</p>
      )}
    </div>
  );
}

function creatureName(id: string, index: WorldIndex): string {
  return index.creatureById.get(id)?.name ?? index.graveyardById.get(id)?.name ?? id;
}

function findCreatureRecord(id: string, index: WorldIndex): CreatureRecord | undefined {
  const living = index.creatureById.get(id);
  if (living) return { creature: living, status: "living" };
  const dead = index.graveyardById.get(id);
  if (dead) return { creature: dead, status: "dead" };
  return undefined;
}

function lineageRelatives(creature: Creature, index: WorldIndex): Array<{ creature: Creature; role: string; status: "living" | "dead" }> {
  const records = [
    { creature, role: "selected", status: "living" as const },
    ...creature.parentIds
      .map((id) => findCreatureRecord(id, index))
      .filter((record): record is CreatureRecord => Boolean(record))
      .map((record) => ({ ...record, role: "parent" })),
    ...creature.ancestorIds
      .map((id) => findCreatureRecord(id, index))
      .filter((record): record is CreatureRecord => Boolean(record))
      .map((record) => ({ ...record, role: "ancestor" }))
  ];
  const seen = new Set<string>();

  return records.filter((record) => {
    if (seen.has(record.creature.id)) return false;
    seen.add(record.creature.id);
    return true;
  }).slice(0, 7);
}

function averageGenomes(genomes: Genome[]): Genome | undefined {
  if (genomes.length === 0) return undefined;
  const totals: Genome = {
    speed: 0,
    vision: 0,
    metabolism: 0,
    fertility: 0,
    aggression: 0,
    sociality: 0,
    foraging: 0,
    immunity: 0,
    heatTolerance: 0,
    coldTolerance: 0,
    predatorSense: 0,
    migrationDrive: 0,
    mutationRate: 0
  };

  for (const genome of genomes) {
    for (const key of genomeKeys) {
      totals[key] += genome[key];
    }
  }

  return {
    speed: totals.speed / genomes.length,
    vision: totals.vision / genomes.length,
    metabolism: totals.metabolism / genomes.length,
    fertility: totals.fertility / genomes.length,
    aggression: totals.aggression / genomes.length,
    sociality: totals.sociality / genomes.length,
    foraging: totals.foraging / genomes.length,
    immunity: totals.immunity / genomes.length,
    heatTolerance: totals.heatTolerance / genomes.length,
    coldTolerance: totals.coldTolerance / genomes.length,
    predatorSense: totals.predatorSense / genomes.length,
    migrationDrive: totals.migrationDrive / genomes.length,
    mutationRate: totals.mutationRate / genomes.length
  };
}

function topGenomeDeltas(genome: Genome, baseline: Genome, count: number): Array<{ gene: keyof Genome; delta: number; value: number; baseline: number }> {
  return genomeKeys
    .map((gene) => ({
      gene,
      delta: genome[gene] - baseline[gene],
      value: genome[gene],
      baseline: baseline[gene]
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, count);
}

function cellFill(cell: World["cells"][number], mode: MapMode): string | undefined {
  if (mode === "terrain") return undefined;
  if (mode === "food") return `hsl(${42 + cell.food * 82} 68% ${18 + cell.food * 28}%)`;
  if (mode === "disease") return `hsl(${355 - cell.disease * 25} 74% ${13 + cell.disease * 42}%)`;
  if (mode === "predators") return `hsl(${35 - cell.predatorPressure * 28} 82% ${15 + cell.predatorPressure * 38}%)`;
  return `hsl(${210 - cell.temperature * 180} 72% ${26 + cell.temperature * 18}%)`;
}

function cellOpacity(cell: World["cells"][number], mode: MapMode): number {
  if (mode === "terrain") return 0.54 + cell.food * 0.42;
  if (mode === "food") return 0.56 + cell.food * 0.42;
  if (mode === "disease") return 0.5 + cell.disease * 0.48;
  if (mode === "predators") return 0.5 + cell.predatorPressure * 0.48;
  return 0.74;
}

function terrainCellOpacity(cell: World["cells"][number]): number {
  return Math.max(0.44, Math.min(0.92, 0.58 + cell.fertility * 0.28 - cell.elevation * 0.08));
}

function eventColor(kind: SimulationEvent["kind"]): string {
  if (kind === "catastrophe") return "#f97316";
  if (kind === "extinction") return "#ef4444";
  if (kind === "speciation") return "#22c55e";
  return "#38bdf8";
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
