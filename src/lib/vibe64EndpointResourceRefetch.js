/**
 * Refetches an endpoint resource without cancelling a request already in flight.
 * @param {{ query: { refetch: (options: { cancelRefetch: boolean }) => Promise<unknown> } }} resource A useEndpointResource result.
 */
function refetchEndpointResource(resource) {
  return resource.query.refetch({
    cancelRefetch: false
  });
}

export { refetchEndpointResource };
