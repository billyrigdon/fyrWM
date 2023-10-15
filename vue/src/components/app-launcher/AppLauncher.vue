<template>
  <div id="autocomplete-container">
    <input type="text" v-model="searchText" @input="onInput" />
  </div>
  <div class="search-results" v-if="filteredApps.length">
    <div v-for="app in filteredApps" :key="app.name" @click="selectApp(app)">
      {{ app.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ipcRenderer } from "electron";

// Data
const searchText = ref("");
const filteredApps = ref<{ name: string; exec: string }[]>([]);
const apps = ref<{ name: string; exec: string }[]>([]);

// Fetch installed apps from Electron's main process
onMounted(async () => {
  apps.value = await ipcRenderer.invoke("getApps");
});

const onInput = () => {
  if (!searchText.value) {
    filteredApps.value = [];
    return;
  }
  filteredApps.value = apps.value.filter((app) =>
    app.name.toLowerCase().includes(searchText.value.toLowerCase())
  );
};

const selectApp = (app: { name: string; exec: string }) => {
  searchText.value = app.name;
  filteredApps.value = [];

  ipcRenderer.send("onLaunchApp", app.exec);
};
</script>

<style lang="scss" scoped>
#autocomplete-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%); // Centering
  display: flex;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  input {
    width: 400px;
    height: 40px;
    padding: 10px 20px;
    border: 1px solid #ccc;
    border-radius: 5px;
    outline: none;
    background-color: white;
    color: black;
  }
}
.search-results {
  background-color: white;
  color: black;
  max-height: 300px;
  width: 400px;
  margin-top: 60px;
  overflow: scroll;
  position: fixed;
  top: calc(
    50% + 40px
  ); // 50% for vertical centering and 40px to accommodate the height of the #autocomplete-container
  left: 50%;
  transform: translate(-50%, -50%);
}
</style>
