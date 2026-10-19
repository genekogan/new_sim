// P1 phones: the people renderer as one lazy chunk: TakePeople (take-replay.ts) and the Mars viewer's humans, fixtures,
// components and character templates behind it. Desktop and old worlds load it at once (their arrival waits for the
// people); a phone's new world draws its first frames with WorldLightPeople and loads this after the arrival.
export { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
export { loadTemplates } from '../../../mars/viewer/app/engine-view/people.ts';
