// Display labels for a selection from Colleague's model catalogue, falling
// back to its ids when the catalogue does not list it.
function selectionLabels(catalog, selection) {
  const engine = (catalog?.engines || []).find(item => item?.engineId === selection.engineId);
  const model = (engine?.modelProviders || []).find(provider => provider.id === selection.modelProviderId)
    ?.models?.find(item => item.id === selection.modelId);
  return { engineLabel: engine?.label || selection.engineId, modelLabel: model?.label || selection.modelId };
}

export { selectionLabels };
