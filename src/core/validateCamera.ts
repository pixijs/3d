import type { View3D } from '../scene/View3D';

/**
 * Validates that the View3D's camera is in a renderable state, throwing if not
 *
 * Called by the per-frame scene update (`updateView3DScene`) right after the transform walk, so
 * `worldVisible` reflects the current frame.
 *
 * The setter on `View3D.camera` catches misconfiguration eagerly at assign time (orphaned cameras
 * get auto-attached, wrong-tree cameras throw). This function is the safety net for what the
 * setter can't see:
 *  - visibility drift (an ancestor was hidden after the camera was assigned)
 *  - graph drift (the camera was removed from the scene graph after assignment)
 *  - a render texture set on the view's own camera, which only a pass camera may draw into
 * @param view3d - The View whose camera is checked
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
    throw new Error(
      'Camera3D is hidden (visible=false or an ancestor is hidden). Cannot render with a hidden camera. ' +
        'See https://github.com/pixijs/pixi-3d/issues/95',
    );
  }
}
