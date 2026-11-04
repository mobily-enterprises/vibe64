function isVibe64LiveQuery(query = {}) {
  const queryKey = Array.isArray(query.queryKey) ? query.queryKey : [];
  return queryKey[0] === "vibe64";
}

/** @param {import("@jskit-ai/kernel/client/types").ClientQueryClient} queryClient */
function invalidateVibe64LiveQueries(queryClient) {
  return queryClient.invalidateQueries({
    predicate: isVibe64LiveQuery,
    refetchType: "active"
  });
}

export {
  invalidateVibe64LiveQueries,
  isVibe64LiveQuery
};
