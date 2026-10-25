// Refetch an endpoint resource without cancelling a request already in flight.
function refetchEndpointResource(resource) {
  if (typeof resource?.query?.refetch === "function") {
    return resource.query.refetch({
      cancelRefetch: false
    });
  }
  return resource?.reload?.();
}

export { refetchEndpointResource };
