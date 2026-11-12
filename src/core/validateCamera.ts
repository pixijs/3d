import type { View3D } from '../scene/View3D';

/**
 * Throws when the view's camera can't render; call it after the transform walk, so `_worldVisible` is this frame's
 * @internal
 */
export function validateCamera(view3d: View3D): void {
  const { camera } = view3d;

  if (camera._view3d !== view3d) {
    throw new Error(
      'Camera3D is no longer in the View3D scene graph. ' +
        "Don't remove an assigned camera from its parent without reassigning view3d.camera.",
    );
  }
  if (camera.renderTexture) {
    throw new Error(
      "The View3D's own camera draws the view, not a texture. Put the render texture on a second " +
        'camera and draw from it with a pass that names that camera.',
    );
  }
  if (!camera.visible || camera._worldVisible === 0) {
    throw new Error('Camera3D is hidden (visible=false or an ancestor is hidden). Cannot render with a hidden camera.');
  }
}
