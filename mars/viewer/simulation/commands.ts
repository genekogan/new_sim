import { z } from 'zod';
import { screenIds } from './shared';
const coordinate = z.number().min(-300).max(300),
  vec = z.tuple([coordinate, z.number().min(0.05).max(200), coordinate]);
export const definitions = {
  move_person: {
    description:
      'Walk an outdoor person to x,z in metres, avoiding the baseline replica obstacles. Use IDs from get_state. Ground y=-0.16. Returns accepted route.',
    schema: z.strictObject({
      person_id: z.string().max(80),
      x: z.number().min(-59).max(59),
      z: z.number().min(-59).max(59),
    }),
  },
  set_person_activity: {
    description:
      'Set a person to idle, wave, talk or wander. Indoor people support stationary activities only.',
    schema: z.strictObject({
      person_id: z.string().max(80),
      activity: z.enum(['idle', 'wave', 'talk', 'wander']),
    }),
  },
  set_environment: {
    description:
      'Set hour and day-night cycle; day_seconds is virtual seconds per full day (default 480).',
    schema: z.strictObject({
      hour: z.number().min(0).max(23.99).optional(),
      cycle: z.boolean().optional(),
      day_seconds: z.number().min(60).max(86400).optional(),
    }),
  },
  set_fire: {
    description:
      'Set the campfire in the model’s designated open clearing: on, off, or automatically after dusk.',
    schema: z.strictObject({ mode: z.enum(['on', 'off', 'auto']) }),
  },
  set_euc_riders: {
    description:
      'Control true single-wheel electric unicycle riders on the whole-campus perimeter. Speed in metres per second.',
    schema: z.strictObject({
      enabled: z.boolean().optional(),
      count: z.number().int().min(0).max(6).optional(),
      speed: z.number().min(0.5).max(6).optional(),
    }),
  },
  set_camera: {
    description:
      'Set camera position and look-at target, metres, Y up. Only viewers who enable Follow remote camera adopt the shot. Camera must remain above ground.',
    schema: z.strictObject({
      position: vec,
      target: z.tuple([coordinate, z.number().min(-0.16).max(200), coordinate]),
    }),
  },
  start_activity: {
    description:
      'Gather 1–8 outdoor people in a circle around x,z for a talk, social gathering or campfire. All routes must be reachable. Campfire gathers at its existing clearing and ignores x,z; other activities use x,z.',
    schema: z.strictObject({
      name: z.enum(['talk', 'gathering', 'campfire']),
      people: z.array(z.string().max(80)).min(1).max(8),
      x: z.number().min(-55).max(55),
      z: z.number().min(-55).max(55),
    }),
  },
  set_paused: {
    description: 'Pause or resume the shared simulation clock and movement.',
    schema: z.strictObject({ paused: z.boolean() }),
  },
  set_weather: {
    description:
      'Set a weather preset, with optional intensity overrides 0–1; wind_direction is degrees. Weather is visual, not physical storm simulation.',
    schema: z.strictObject({
      preset: z.enum(['clear', 'cloudy', 'rainy', 'windy', 'dusty']).optional(),
      clouds: z.number().min(0).max(1).optional(),
      rain: z.number().min(0).max(1).optional(),
      wind: z.number().min(0).max(1).optional(),
      dust: z.number().min(0).max(1).optional(),
      wind_direction: z.number().min(0).max(360).optional(),
    }),
  },
  set_simulation_speed: {
    description:
      'Set virtual time rate 0.1–8. Affects people, riders, sky, screens and camera paths. Pause is separate and retained.',
    schema: z.strictObject({ rate: z.number().min(0.1).max(8) }),
  },
  move_group: {
    description:
      'Move an explicit group or all outdoor walkers to a spaced formation around x,z. Routes are validated atomically; rejected if any destination is blocked.',
    schema: z.strictObject({
      people: z.union([
        z.literal('all'),
        z.array(z.string().max(80)).min(1).max(8),
      ]),
      x: z.number().min(-55).max(55),
      z: z.number().min(-55).max(55),
      spacing: z.number().min(1).max(5).default(2),
    }),
  },
  set_camera_trajectory: {
    description:
      'Orbit/spiral around a target. Duration in virtual seconds for the whole trajectory; turns may be negative. A looping spiral returns smoothly along its height/radius range, with continuous angular motion. Viewers must enable Follow remote camera.',
    schema: z.strictObject({
      target: z
        .tuple([coordinate, z.number().min(-0.16).max(100), coordinate])
        .default([0, 2, 8]),
      radius: z.number().min(2).max(150).default(35),
      end_radius: z.number().min(2).max(150).optional(),
      height: z.number().min(0.2).max(150).default(15),
      end_height: z.number().min(0.2).max(150).optional(),
      turns: z
        .number()
        .int()
        .min(-8)
        .max(8)
        .refine((n) => n !== 0)
        .default(1),
      duration: z.number().min(5).max(3600).default(120),
      loop: z.boolean().default(true),
    }),
  },
  set_camera_path: {
    description:
      'Traverse 2–32 camera position/look-at keyframes with equal time per segment. Duration in virtual seconds. Looping paths append the first keyframe to close the path. Keep clearance from buildings; only ground clearance is enforced.',
    schema: z.strictObject({
      points: z
        .array(
          z.strictObject({
            position: vec,
            target: z.tuple([
              coordinate,
              z.number().min(-0.16).max(200),
              coordinate,
            ]),
          }),
        )
        .min(2)
        .max(32),
      duration: z.number().min(5).max(3600),
      loop: z.boolean().default(false),
    }),
  },
  stop_camera: {
    description: 'Freeze the remote camera at its current trajectory pose.',
    schema: z.strictObject({}),
  },
  command_euc_riders: {
    description:
      'Command all enabled riders or selected euc-1…euc-6 to circle, return to the campus parking area, stop, or dismount. Return optionally dismounts on arrival; circle remounts and joins the perimeter without teleporting. Calls reject disabled riders. Ground routes avoid baseline obstacles.',
    schema: z.strictObject({
      riders: z
        .union([
          z.literal('all'),
          z
            .array(
              z.enum(['euc-1', 'euc-2', 'euc-3', 'euc-4', 'euc-5', 'euc-6']),
            )
            .min(1)
            .max(6),
        ])
        .default('all'),
      action: z.enum(['circle', 'return', 'stop', 'dismount']),
      dismount_on_arrival: z.boolean().default(true),
    }),
  },
  set_screens: {
    description:
      'Switch the hall projector and gallery monitors on/off, set art/talk/test program, brightness and a plain-text talk title. Discover screen IDs with get_capabilities. No external URL playback.',
    schema: z.strictObject({
      screens: z
        .union([z.literal('all'), z.array(z.enum(screenIds)).min(1).max(7)])
        .default('all'),
      enabled: z.boolean().optional(),
      program: z.enum(['art', 'talk', 'test']).optional(),
      brightness: z.number().min(0.1).max(2).optional(),
      title: z.string().max(100).optional(),
    }),
  },
  apply_scene: {
    description:
      'Apply up to 12 commands atomically at one clock instant. Use for coordinated weather, camera, riders, people and screens. Nested apply_scene and reset_simulation are forbidden; inspect each command schema in tools/list.',
    schema: z.strictObject({
      commands: z
        .array(
          z.strictObject({
            name: z.string().max(60),
            args: z.record(z.string(), z.unknown()),
          }),
        )
        .min(1)
        .max(12),
    }),
  },
  reset_simulation: {
    description:
      'Reset this room’s simulation to defaults. Does not edit the campus geometry.',
    schema: z.strictObject({}),
  },
} as const;
