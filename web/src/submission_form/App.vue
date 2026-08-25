<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchTemplates, type TemplateListItem, type TemplatesResponse } from '../shared/api';

// PLACEHOLDER island app standing in for submission_form/form.vue.
// Proves the second pack builds and reaches the Express API the same way.
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
    <h1 class="text-xl font-bold">Submission Form Island</h1>
    <p class="text-sm opacity-70">
      Placeholder mount point for the real <code>submission_form/form.vue</code> pack.
      Pick a template to sign (fetched from <code>/templates</code>):
    </p>

    <div v-if="loading" class="loading loading-spinner"></div>
    <div v-else-if="error" class="alert alert-error">{{ error }}</div>
    <ul v-else class="menu bg-base-200 rounded-box w-96">
      <li v-for="t in templates" :key="t.id"><a href="#">{{ t.name }}</a></li>
    </ul>

    <div v-if="pagination" class="text-sm opacity-70">
      Page {{ pagination.page }} of {{ pagination.total_pages }}
    </div>
  </div>
</template>
