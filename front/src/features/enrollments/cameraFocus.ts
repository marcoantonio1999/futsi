type FocusCapabilities = MediaTrackCapabilities & { focusMode?: string[] };

export async function enableContinuousFocus(track: MediaStreamTrack): Promise<void> {
  try {
    const capabilities = track.getCapabilities?.() as FocusCapabilities | undefined;
    if (!capabilities?.focusMode?.includes("continuous")) return;
    const constraints = track.getConstraints();
    await track.applyConstraints({
      ...constraints,
      advanced: [...(constraints.advanced || []), { focusMode: "continuous" } as MediaTrackConstraintSet],
    });
  } catch {
    // Camera preview remains usable when the browser cannot change its focus.
  }
}
