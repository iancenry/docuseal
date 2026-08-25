<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchTemplates, type TemplateListItem, type TemplatesResponse } from '../shared/api';

// PLACEHOLDER island app (see integrations.md for the real-pack port decision).
// Proves the architecture: Vue 3 island -> Vite build/proxy -> Express JSON API.
const templates = ref<TemplateListItem[]>([]);
const pagination = ref<TemplatesResponse['pagination']>();
const error = ref<string | null>(null);
const loading = ref(true);

async function load(page = 1): Promise<void> {
  loading.value = true;
  error.value = null;
  const res = await fetchTemplates(page);
  if (res.error) {
    error.value = res.error;
  } else {
    templates.value = res.data ?? [];
    pagination.value = res.pagination;
  }
  loading.value = false;
}

onMounted(() => void load());
</script>

<template>
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-bold">Template Builder Island</h1>
    <p class="text-sm opacity-70">
      Placeholder mount point for the real <code>template_builder/builder.vue</code> pack.
      Fetching <code>/templates</code> through the Express API:
    </p>

    <div v-if="loading" class="loading loading-spinner"></div>
    <div v-else-if="error" class="alert alert-error">{{ error }}</div>
    <table v-else class="table table-sm">
      <thead>
        <tr><th>ID</th><th>Name</th><th>Author</th><th>Updated</th></tr>
      </thead>
      <tbody>
        <tr v-for="t in templates" :key="t.id">
          <td>{{ t.id }}</td>
          <td>{{ t.name }}</td>
          <td>{{ t.author?.email }}</td>
          <td>{{ t.updated_at }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="pagination" class="text-sm opacity-70">
      Page {{ pagination.page }} of {{ pagination.total_pages }} ({{ pagination.count }} templates)
    </div>
  </div>
</template>
