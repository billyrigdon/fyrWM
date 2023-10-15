<template>
  <div id="autocomplete-container">
    <input
      type="text"
      id="autocomplete-input"
      v-model="searchText"
      @input="onInput"
      @keydown="onKeyDown"
    />
  </div>
  <div class="search-results" v-if="filteredApps.length" ref="resultsContainer">
    <div
      v-for="(app, index) in filteredApps"
      :key="app.name"
      :class="{ highlighted: highlightedIndex === index }"
      @click="selectApp(app)"
    >
      {{ app.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ipcRenderer } from "electron";

const searchText = ref("");
const filteredApps = ref<{ name: string; exec: string }[]>([]);
const apps = ref<{ name: string; exec: string }[]>([]);
const highlightedIndex = ref(-1); // Index for keyboard navigation
const resultsContainer = ref<HTMLElement | null>(null); // Reference to the results container

// Fetch installed apps from Electron's main process
onMounted(async () => {
  apps.value = await ipcRenderer.invoke("getApps");
  const inputElement = document.getElementById("autocomplete-input");
  if (inputElement) {
    inputElement.focus();
  }
});

onMounted(async () => {
  apps.value = await ipcRenderer.invoke("getApps");
  const inputElement = document.getElementById("autocomplete-input");
  if (inputElement) {
    inputElement.focus();
  }
});

const onInput = () => {
  // Reset the highlighted index when search text changes
  highlightedIndex.value = -1;

  if (!searchText.value) {
    filteredApps.value = [];
    return;
  }
  filteredApps.value = apps.value.filter((app) =>
    app.name.toLowerCase().includes(searchText.value.toLowerCase())
  );
};

const onKeyDown = (e: KeyboardEvent) => {
  switch (e.key) {
    case "ArrowDown":
      highlightedIndex.value = Math.min(
        highlightedIndex.value + 1,
        filteredApps.value.length - 1
      );
      scrollIfNeeded();
      break;
    case "ArrowUp":
      highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
      scrollIfNeeded();
      break;
    case "Enter":
      if (highlightedIndex.value >= 0) {
        selectApp(filteredApps.value[highlightedIndex.value]);
      }
      break;
    default:
      break;
  }
};

const navigate = (direction: number) => {
  if (filteredApps.value.length === 0) return;
  highlightedIndex.value += direction;
  highlightedIndex.value = Math.max(
    0,
    Math.min(filteredApps.value.length - 1, highlightedIndex.value)
  );
};

const scrollIfNeeded = () => {
  if (resultsContainer.value) {
    const items = resultsContainer.value.querySelectorAll("div");
    const item = items[highlightedIndex.value];
    if (item) {
      item.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
};

const selectCurrent = () => {
  if (highlightedIndex.value >= 0) {
    selectApp(filteredApps.value[highlightedIndex.value]);
  }
};

const selectApp = (app: { name: string; exec: string }) => {
  searchText.value = app.name;
  filteredApps.value = [];
  highlightedIndex.value = -1;

  ipcRenderer.send("onLaunchApp", app.exec);
};
</script>

<style lang="scss" scoped>
::-webkit-scrollbar {
  display: none;
}

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
    width: 420px !important;
    height: 40px;
    border-radius: 5px;
    outline: none;
    background-color: #ffffff;
    color: black;
    // opacity: 0.9;
    box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
  }
}
.search-results {
  background-color: #ffffff;
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
  color: black;
  // opacity: 0.9;
  min-height: 300px;
  max-height: 300px;
  width: 425px !important;
  margin-top: 59px;
  overflow: scroll;
  position: fixed;
  border-bottom-left-radius: 5px;
  border-bottom-right-radius: 5px;
  top: calc(50% + 110px);
  left: 50%;
  transform: translate(-50%, -50%);

  div {
    cursor: pointer;
  }
  div:hover,
  .highlighted {
    width: 100%;
    background-color: #73358c;
    color: white;
  }
}
</style>
