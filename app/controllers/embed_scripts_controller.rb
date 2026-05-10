# frozen_string_literal: true

class EmbedScriptsController < ActionController::Metal
  EMBED_SCRIPT = <<~JAVASCRIPT.freeze
    (function() {
      const DEFAULT_HOST = window.location.origin;

      class DocuSealBuilder extends HTMLElement {
        connectedCallback() {
          const token = this.getAttribute('data-token');
          const templateId = this.getAttribute('data-template-id');
          const host = this.getAttribute('data-host') || DEFAULT_HOST;
          const width = this.getAttribute('data-width') || '100%';
          const height = this.getAttribute('data-height') || '800px';

          if (!token) {
            this.innerHTML = '<p style="color:red;">Error: data-token attribute is required</p>';
            return;
          }

          const iframe = document.createElement('iframe');
          const params = new URLSearchParams({ token: token });
          if (templateId) params.set('template_id', templateId);

          iframe.src = host + '/embed/builder?' + params.toString();
          iframe.style.width = width;
          iframe.style.height = height;
          iframe.style.border = 'none';
          iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads');
          iframe.setAttribute('allowfullscreen', 'true');
          iframe.setAttribute('allow', 'clipboard-write');

          this._iframe = iframe;
          this.appendChild(iframe);

          this._messageHandler = function(event) {
            if (event.source !== iframe.contentWindow) return;
            if (!event.data || !event.data.type) return;
            if (!event.data.type.startsWith('docuseal:')) return;

            const customEvent = new CustomEvent(event.data.type, { detail: event.data.data });
            this.dispatchEvent(customEvent);
          }.bind(this);
          window.addEventListener('message', this._messageHandler);
        }

        disconnectedCallback() {
          if (this._messageHandler) {
            window.removeEventListener('message', this._messageHandler);
            this._messageHandler = null;
          }
        }
      }

      class DocuSealForm extends HTMLElement {
        connectedCallback() {
          const token = this.getAttribute('data-token');
          const submissionId = this.getAttribute('data-submission-id');
          const slug = this.getAttribute('data-slug');
          const email = this.getAttribute('data-email');
          const host = this.getAttribute('data-host') || DEFAULT_HOST;
          const width = this.getAttribute('data-width') || '100%';
          const height = this.getAttribute('data-height') || '800px';

          if (!token) {
            this.innerHTML = '<p style="color:red;">Error: data-token attribute is required</p>';
            return;
          }

          const iframe = document.createElement('iframe');
          const params = new URLSearchParams({ token: token });
          if (submissionId) params.set('submission_id', submissionId);
          if (slug) params.set('slug', slug);
          if (email) params.set('email', email);

          iframe.src = host + '/embed/form?' + params.toString();
          iframe.style.width = width;
          iframe.style.height = height;
          iframe.style.border = 'none';
          iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads');
          iframe.setAttribute('allowfullscreen', 'true');

          this._iframe = iframe;
          this.appendChild(iframe);

          this._messageHandler = function(event) {
            if (event.source !== iframe.contentWindow) return;
            if (!event.data || !event.data.type) return;
            if (!event.data.type.startsWith('docuseal:')) return;

            const customEvent = new CustomEvent(event.data.type, { detail: event.data.data });
            this.dispatchEvent(customEvent);
          }.bind(this);
          window.addEventListener('message', this._messageHandler);
        }

        disconnectedCallback() {
          if (this._messageHandler) {
            window.removeEventListener('message', this._messageHandler);
            this._messageHandler = null;
          }
        }
      }

      if (!window.customElements.get('docuseal-builder')) {
        window.customElements.define('docuseal-builder', DocuSealBuilder);
      }

      if (!window.customElements.get('docuseal-form')) {
        window.customElements.define('docuseal-form', DocuSealForm);
      }
    })();
  JAVASCRIPT

  def show
    headers['Content-Type'] = 'application/javascript'
    headers['Cache-Control'] = 'public, max-age=3600'
    headers['Access-Control-Allow-Origin'] = '*'

    self.response_body = EMBED_SCRIPT

    self.status = 200
  end
end
