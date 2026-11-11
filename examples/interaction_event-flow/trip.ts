/**
 * The record of the latest press on a node, which `index.ts`'s listeners write, the visuals frame and the pane prints
 *
 * The listeners read the event's fields and hand over plain values, so every read of the event is in `index.ts`.
 */

import type { Container3D } from '@pixi/3d';

/** One listener that ran */
export interface Hop {
  /** The node it ran on, `e.currentTarget3D` */
  node: Container3D;
  /** The `e.eventPhase` it saw */
  phase: number;
  /** Whether it ran on the target itself, where `e.eventPhase` is `e.AT_TARGET` */
  atTarget: boolean;
  /** Whether it called `e.stopPropagation()`, which made it the last listener of the trip */
  stopped: boolean;
}

/** What the listeners heard on the latest press on a node */
export interface Trip {
  /** The press it records, by the View's count */
  press: number;
  /** `e.target3D`'s label: the node the press is for, the same on every hop */
  target3D: string;
  /** Each 3D listener that ran, in the order it ran */
  hops: Hop[];
  /** The event log: a header, then each listener's eventPhase and currentTarget3D, the View's last */
  log: string;
}

/** Which node's listener calls stopPropagation(), by its label ('' for none), and in which phase */
export interface StopSettings {
  at: string;
  phase: 'capture' | 'bubble';
}

/** eventPhase's values by name, for the log: pixi's CAPTURING_PHASE (1), AT_TARGET (2) and BUBBLING_PHASE (3) */
const PHASE_NAMES = ['none', 'capture', 'target', 'bubble'];

/** What the log reads before a press, and again once a change in the pane has cleared it */
const EMPTY_LOG = 'press the cube, ball or table';

export function createTrip(): Trip {
  return { press: 0, target3D: '', hops: [], log: EMPTY_LOG };
}

/** Starts the record over for a new press */
export function startTrip(trip: Trip, press: number, target3D: string): void {
  trip.press = press;
  trip.target3D = target3D;
  trip.hops.length = 0;
  trip.log = 'eventPhase currentTarget3D';
}

/** Empties the record, since the press it holds ran under settings the pane has just changed */
export function clearTrip(trip: Trip): void {
  trip.target3D = '';
  trip.hops.length = 0;
  trip.log = EMPTY_LOG;
}

/** Records and logs a 3D listener's hop */
export function recordHop(trip: Trip, hop: Hop): void {
  trip.hops.push(hop);
  writeLine(trip, hop.phase, hop.node.label ?? '', hop.stopped ? 'stopPropagation()' : '');
}

/** Logs the eventPhase and currentTarget3D the View's own listeners read */
export function recordView(trip: Trip, phase: number, currentTarget3D: string): void {
  writeLine(trip, phase, currentTarget3D, 'view3d heard it');
}

function writeLine(trip: Trip, phase: number, current: string, note: string): void {
  trip.log += `\n${phase} ${PHASE_NAMES[phase].padEnd(9)}${current.padEnd(6)}${note}`;
}
