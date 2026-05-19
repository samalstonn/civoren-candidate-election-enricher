export const cancelRegistry = new Set<string>();
export const activeBatches = new Map<
  string,
  { total: number; startedAt: number; processing: Set<number> }
>();

