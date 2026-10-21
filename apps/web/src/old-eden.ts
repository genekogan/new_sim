// P1 phones: the old Eden expansion (/w/eden's hand-built town: ~460 KB of eden-* builders) loads as its own chunk, only
// for a world that shows it. LiveWorld imports this module dynamically (loadOldEden); nothing else may import it statically.
export {createWorldEdenExpansion,prebuildEdenLandscape} from './WorldEdenExpansion.ts';
export {createEdenHouseWindows} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-house-windows.ts';
