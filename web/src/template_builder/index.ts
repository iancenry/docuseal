import { createApp } from 'vue';
import App from './App.vue';
import '../styles.css';

function mountIsland(hostId: string): void {
  const host = document.getElementById(hostId) ?? document.body;
  const target = document.createElement('div');
  host.appendChild(target);
  createApp(App).mount(target);
}

mountIsland('template-builder-root');
