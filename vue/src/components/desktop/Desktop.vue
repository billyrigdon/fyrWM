<template>
  <div class="wallpaper-container">
    <!-- <img :src="imageSrc" alt="Wallpaper" class="wallpaper-image" /> -->
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { ipcRenderer } from "electron";

// Define imageSrc ref here
const imageSrc = ref("");
onMounted(() => {
  ipcRenderer.send("get-wallpaper");
  ipcRenderer.on("set-wallpaper", (event, path) => {
    imageSrc.value = path;
  });
});
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  border: 0;
  overflow: hidden;
}
.wallpaper-container,
.wallpaper-image {
  width: 100%;
  height: 100%;
  overflow: hidden;
  margin: 0;
  padding: 0;
}

.wallpaper-image {
  object-fit: fill;
}
</style>
