<script setup>
definePage({
  redirect: (to) => ({
    path: "/home/dashboard/history",
    query: to.query
  })
});
</script>
