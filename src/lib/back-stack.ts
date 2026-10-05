const layers: Array<() => void> = [];

export function pushBackLayer(dismiss: () => void) {
  layers.push(dismiss);
  return () => {
    const index = layers.lastIndexOf(dismiss);
    if (index >= 0) layers.splice(index, 1);
  };
}

export function popBackLayer() {
  const dismiss = layers.pop();
  if (!dismiss) return false;
  dismiss();
  return true;
}

export function backLayerCount() {
  return layers.length;
}
