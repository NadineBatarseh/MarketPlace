import { C } from '../constants.js';
import { getRoadDistanceKm } from '../distanceProvider.js';
import { Coordinates, IntraCityTask } from '../types.js';

// Phase 10 â€” Intra-City Sequencing
// Produces an ordered stop list from a set of pickup and delivery tasks
// inside a single city, using Greedy Nearest Neighbor + 2-opt improvement.

// â”€â”€ Running capacity tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function applyVolumeChange(current: number, task: IntraCityTask): number {
  return task.type === 'pickup'
    ? current + task.volume
    : current - task.volume;
}

// â”€â”€ D29 â€” Pickup capacity feasibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// pickup feasible if current_volume + task.volume â‰¤ MAX_VOLUME
function isCapacityFeasible(task: IntraCityTask, currentVolume: number): boolean {
  if (task.type === 'delivery') return true;
  return currentVolume + task.volume <= C.MAX_VOLUME;
}

// â”€â”€ D30 â€” Merchant readiness check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// pickup feasible if current_time â‰¥ task.ready_time
function isReadyTimeFeasible(task: IntraCityTask, now: Date): boolean {
  if (task.type === 'delivery' || !task.ready_time) return true;
  return now >= new Date(task.ready_time);
}

// â”€â”€ D31 â€” Task score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// task_score = W_dist أ— distance(current, task) - W_urg أ— urgency_score
// Lower score = visit sooner
function scoreTask(
  task: IntraCityTask,
  currentLocation: Coordinates
): number {
  const dist = getRoadDistanceKm(
    currentLocation.lat, currentLocation.lng,
    task.location.lat, task.location.lng
  );
  return C.W_DIST * dist - C.W_URG * task.urgency_score;
}

// â”€â”€ Step 10a â€” Greedy nearest neighbor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function greedySequence(
  tasks: IntraCityTask[],
  entryPoint: Coordinates,
  initialVolume: number
): IntraCityTask[] {
  const unvisited = [...tasks];
  const sequence: IntraCityTask[] = [];
  let currentLocation = entryPoint;
  let currentVolume = initialVolume;
  const now = new Date();

  while (unvisited.length > 0) {
    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const task = unvisited[i];

      // D29 and D30 â€” skip infeasible tasks
      if (!isCapacityFeasible(task, currentVolume)) continue;
      if (!isReadyTimeFeasible(task, now)) continue;

      const s = scoreTask(task, currentLocation);
      if (s < bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      // All remaining tasks are infeasible right now (e.g. merchants not ready).
      // Take the one with the nearest deadline regardless and wait.
      const fallback = unvisited.reduce((min, t) =>
        new Date(t.deadline) < new Date(min.deadline) ? t : min
      );
      bestIdx = unvisited.indexOf(fallback);
    }

    const chosen = unvisited.splice(bestIdx, 1)[0];
    sequence.push(chosen);
    currentLocation = chosen.location;
    currentVolume = applyVolumeChange(currentVolume, chosen);
  }

  return sequence;
}

// â”€â”€ Capacity validity check for a full sequence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isCapacityValidThroughout(
  sequence: IntraCityTask[],
  initialVolume: number
): boolean {
  let vol = initialVolume;
  for (const task of sequence) {
    vol = applyVolumeChange(vol, task);
    if (vol > C.MAX_VOLUME || vol < 0) return false;
  }
  return true;
}

// â”€â”€ Total route distance for a sequence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function totalDistance(
  sequence: IntraCityTask[],
  entryPoint: Coordinates
): number {
  let dist = 0;
  let prev = entryPoint;
  for (const task of sequence) {
    dist += getRoadDistanceKm(prev.lat, prev.lng, task.location.lat, task.location.lng);
    prev = task.location;
  }
  return dist;
}

// â”€â”€ D32 â€” 2-opt swap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Accept swap if:
//   new_total_distance < current_total_distance
//   AND capacity is valid throughout the reversed segment
function twoOptImprove(
  sequence: IntraCityTask[],
  entryPoint: Coordinates,
  initialVolume: number
): IntraCityTask[] {
  let improved = true;
  let best = [...sequence];
  let bestDist = totalDistance(best, entryPoint);

  while (improved) {
    improved = false;

    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        // Reverse the sub-route between i and j
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];

        const candidateDist = totalDistance(candidate, entryPoint);

        if (
          candidateDist < bestDist &&
          isCapacityValidThroughout(candidate, initialVolume)
        ) {
          best = candidate;
          bestDist = candidateDist;
          improved = true;
        }
      }
    }
  }

  return best;
}

// â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function sequenceIntraCityTasks(
  tasks: IntraCityTask[],
  entryPoint: Coordinates,
  initialVolume: number
): IntraCityTask[] {
  if (tasks.length === 0) return [];

  const greedy = greedySequence(tasks, entryPoint, initialVolume);
  return twoOptImprove(greedy, entryPoint, initialVolume);
}
