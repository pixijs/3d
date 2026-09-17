import { extensions } from 'pixi.js';

import { Container3D } from '../scene/Container3D';
import { View3D } from '../scene/View3D';
import { FederatedContainer3D } from './FederatedEventTarget3D';
import { View3DEvents } from './View3DEvents';

extensions.mixin(Container3D, FederatedContainer3D);
extensions.mixin(View3D, View3DEvents);
