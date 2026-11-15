// The desk plate (public/media/desk-loop.mp4) is a filmed desk the 3D sheets and fan sit on.
// It was generated from a layout guide rendered with this exact camera (scripts/desk-guide.mjs),
// so the 3D scene uses the same numbers and the sheets land on the filmed leather.
// Units are metres; the desk top is y = 0, the camera looks toward -z.
export const DESK_PLATE = {
  camera: { pos: [0, 0.78, 0.62], look: [0, 0, -0.12], vfov: 50 },
  /**
   * The off-screen lamp lighting the plate, found by reflecting the view ray at the leather's
   * specular highlight (image 0.24, 0.58) back up off the desk: just above the frame, top left.
   */
  lamp: [-0.23, 0.5, -0.42],
  /** The green leather writing surface (x0, x1, z0, z1). */
  leather: [-0.775, 0.775, -0.475, 0.285],
};
