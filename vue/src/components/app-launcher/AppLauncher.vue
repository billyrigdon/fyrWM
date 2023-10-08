<template>
  <div id="autocomplete-container">
    <input type="text" v-model="searchText" @input="onInput" />
    <div v-if="filteredApps.length">
      <div v-for="app in filteredApps" :key="app.name" @click="selectApp(app)">
        {{ app.name }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineProps, onMounted } from "vue";
import { ipcRenderer } from "electron";

// Data
const searchText = ref("");
const filteredApps = ref<{ name: string; exec: string }[]>([]);
const apps = ref<{ name: string; exec: string }[]>([]);

// Fetch installed apps from Electron's main process
onMounted(async () => {
  apps.value = await ipcRenderer.invoke("getApps");
});

// Methods
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

  // Send message to Electron's main process
  ipcRenderer.send("onLaunchApp", app.exec); // Sending the command instead of the name
};
</script>

<style lang="scss" scoped>
#autocomplete-container {
  display: flex;
  width: 100%;
  height: 100%;
  border-radius: 5px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  input {
    width: 100%;
    height: 100%;
  }
}
</style>
