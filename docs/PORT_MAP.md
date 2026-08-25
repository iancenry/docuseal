# PORT_MAP.md — Rails → Node.js/Express Route Inventory

Source: `config/routes.rb` (+ verification against `app/controllers/**`).
Every row's **Port status** is `todo`.

## Totals

- **Total routes: 270**
- Per group:
  - API (`/api/...`): 37
  - Embed (incl. `/js/:filename` loader): 13
  - MCP: 1
  - Web UI (incl. Settings sub-group): 175
  - Devise/auth: 9
  - ActiveStorage/uploads: 17
  - Webhooks: 16
  - Other (engine mounts): 2
- Conditional routes are included and flagged: *(dev)*, *(non-multitenant)*, *(multitenant)*, *(demo || non-multitenant)*. Default OSS deployment runs non-multitenant, so multitenant-only routes are inactive there.

### 10 most complex controllers (by `wc -l`)

| # | File | Lines |
|---|------|-------|
| 1 | `app/controllers/api/submissions_pdf_controller.rb` | 287 |
| 2 | `app/controllers/start_form_controller.rb` | 253 |
| 3 | `app/controllers/api/submissions_docx_controller.rb` | 243 |
| 4 | `app/controllers/api/stripe_payments_controller.rb` | 233 |
| 5 | `app/controllers/api/submitters_controller.rb` | 230 |
| 6 | `app/controllers/api/submissions_html_controller.rb` | 221 |
| 7 | `app/controllers/api/submissions_controller.rb` | 213 |
| 8 | `app/controllers/api/templates_controller.rb` | 157 |
| 9 | `app/controllers/api/stripe_connect_controller.rb` | 147 |
| 10 | `app/controllers/application_controller.rb` | 146 |

---

## API (`/api/...`, JSON by default)

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/api/user` | `api/users#show` | Current authenticated user profile + token info | todo |
| `POST` | `/api/attachments` | `api/attachments#create` | Upload attachment for a submitter form field | todo |
| `POST` | `/api/submitter_email_clicks` | `api/submitter_email_clicks#create` | Track submitter email link click events | todo |
| `POST` | `/api/submitter_form_views` | `api/submitter_form_views#create` | Track submitter form view events | todo |
| `GET` | `/api/submitters` | `api/submitters#index` | Paginated list/filter of submitters | todo |
| `GET` | `/api/submitters/:id` | `api/submitters#show` | Single submitter detail | todo |
| `PATCH/PUT` | `/api/submitters/:id` | `api/submitters#update` | Update submitter values/preferences/completion | todo |
| `GET` | `/api/submissions` | `api/submissions#index` | Paginated list/filter of submissions | todo |
| `POST` | `/api/submissions` | `api/submissions#create` | Create submission(s) from template with submitters | todo |
| `GET` | `/api/submissions/:id` | `api/submissions#show` | Submission detail incl. submitters/documents | todo |
| `DELETE` | `/api/submissions/:id` | `api/submissions#destroy` | Archive (soft-delete) a submission | todo |
| `GET` | `/api/submissions/:submission_id/documents` | `api/submission_documents#index` | List completed/merged documents of a submission | todo |
| `POST` | `/api/submissions/init` | `api/submissions#create` | Legacy alias of submission create | todo |
| `POST` | `/api/submissions/emails` | `api/submissions#create` | Legacy alias of submission create (email-named helper) | todo |
| `POST` | `/api/submissions/pdf` | `api/submissions_pdf#create` | Build template from uploaded PDF then create submissions | todo |
| `POST` | `/api/submissions/docx` | `api/submissions_docx#create` | Build template from uploaded DOCX then create submissions | todo |
| `POST` | `/api/submissions/html` | `api/submissions_html#create` | Build template from HTML then create submissions | todo |
| `GET` | `/api/templates` | `api/templates#index` | Paginated list/filter of templates | todo |
| `GET` | `/api/templates/:id` | `api/templates#show` | Template detail with documents/fields | todo |
| `PATCH/PUT` | `/api/templates/:id` | `api/templates#update` | Update template schema/fields/folder | todo |
| `DELETE` | `/api/templates/:id` | `api/templates#destroy` | Archive (soft-delete) a template | todo |
| `POST` | `/api/templates/:template_id/clone` | `api/templates_clone#create` | Duplicate a template | todo |
| `GET` | `/api/templates/:template_id/submissions` | `api/submissions#index` | List submissions of a template | todo |
| `POST` | `/api/templates/:template_id/submissions` | `api/submissions#create` | Create submissions for a specific template | todo |
| `POST` | `/api/templates/html` | `api/templates_html#create` | Create template from HTML string payload | todo |
| `POST` | `/api/templates/pdf` | `api/templates_pdf_tags#create` | Create template from PDF using text-tag syntax | todo |
| `POST` | `/api/templates/docx` | `api/templates_docx#create` | Create template from DOCX with text tags | todo |
| `POST` | `/api/tools/merge` | `api/tools#merge` | Merge multiple uploaded PDFs into one | todo |
| `POST` | `/api/tools/verify` | `api/tools#verify` | Verify PDF digital signatures | todo |
| `GET` | `/api/events/form/:type` | `api/form_events#index` | Form audit event feed filtered by type | todo |
| `GET` | `/api/events/submission/:type` | `api/submission_events#index` | Submission audit event feed filtered by type | todo |
| `POST` | `/api/embed_tokens` | `api/embed_tokens#create` | Issue scoped JWT embed token for builder/forms embedding | todo |
| `GET` | `/api/stripe_connect` | `api/stripe_connect#show` | Show connected Stripe account status | todo |
| `POST` | `/api/stripe_connect` | `api/stripe_connect#create` | Create Stripe Connect onboarding/login link | todo |
| `DELETE` | `/api/stripe_connect` | `api/stripe_connect#destroy` | Disconnect Stripe account config | todo |
| `POST` | `/api/stripe_payments` | `api/stripe_payments#create` | Create Stripe checkout/payment session for payment field | todo |
| `PATCH/PUT` | `/api/stripe_payments/:id` | `api/stripe_payments#update` | Check/sync payment status for a submitter field | todo |

## Embed

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `OPTIONS` | `/embed/*path` | `embed/base#preflight` | CORS preflight for all embed endpoints | todo |
| `OPTIONS` | `/embed/` | `embed/base#preflight` | CORS preflight for embed root | todo |
| `GET` | `/embed/builder` | `embed/builders#show` | Load existing template into embedded builder | todo |
| `POST` | `/embed/builder` | `embed/builders#create` | Create new template via embedded builder | todo |
| `PUT` | `/embed/builder/update` | `embed/builders#update` | Save/update embedded builder template schema | todo |
| `POST` | `/embed/builder/documents` | `embed/builders#documents` | Upload document file(s) into embedded builder | todo |
| `GET` | `/embed/builder/documents_index` | `embed/builders#documents_index` | List documents attached to embedded template | todo |
| `POST` | `/embed/builder/detect_fields` | `embed/builder_detect_fields#create` | Auto-detect fields in embedded builder document | todo |
| `POST` | `/embed/builder/custom_fields` | `embed/builders#custom_fields` | Save custom fields for embedded template | todo |
| `GET` | `/embed/form` | `embed/forms#show` | Render embedded signer form for embed token | todo |
| `GET` | `/embed/form/completed` | `embed/forms#completed` | Completed state of embedded form | todo |
| `PUT` | `/embed/form/:slug` | `embed/forms#update` | Submit values/attachments from embedded form | todo |
| `GET` | `/js/:filename` | `embed_scripts#show` | Serve embed JS loader scripts (custom elements) | todo |

## MCP

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET+POST` | `/mcp` | `mcp#call` | MCP protocol endpoint (auth via per-user MCP token) | todo |

> Note: MCP token management UI lives under Settings -> `/settings/mcp*` (see Web UI group).

## Web UI

### Core pages

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/` | `dashboard#index` | Root: dashboard or landing/demo handling | todo |
| `GET` | `/dashboard` | `dashboard#index` | Main authenticated dashboard | todo |
| `GET` | `/up` | `rails/health#show` | Health check endpoint (Rails health controller) | todo |
| `GET` | `/manifest` | `pwa#manifest` | PWA webmanifest (implicit template render) | todo |
| `GET` | `/setup` | `setup#index` | First-run admin account setup page | todo |
| `POST` | `/setup` | `setup#create` | Create first admin account during setup | todo |
| `GET` | `/newsletter` | `newsletters#show` | Newsletter subscription prompt page | todo |
| `PATCH/PUT` | `/newsletter` | `newsletters#update` | Save newsletter opt-in preference | todo |
| `POST` | `/enquiries` | `enquiries#create` | Sales/support enquiry form submit | todo |
| `POST` | `/verify_pdf_signature` | `verify_pdf_signature#create` | Verify uploaded PDF signature (page + result) | todo |

### Templates & folders

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/templates` | `templates_dashboard#index` | Templates list dashboard (filters/search/order) | todo |
| `GET` | `/templates/archived` | `templates_archived#index` | Archived templates list | todo |
| `GET` | `/templates/new` | `templates#new` | New template creation page | todo |
| `POST` | `/templates` | `templates#create` | Create template from upload/URL | todo |
| `GET` | `/templates/:id/edit` | `templates#edit` | Template builder editor page | todo |
| `GET` | `/templates/:id` | `templates#show` | Template overview page | todo |
| `PATCH/PUT` | `/templates/:id` | `templates#update` | Update template schema/name/folder | todo |
| `DELETE` | `/templates/:id` | `templates#destroy` | Move template to archived | todo |
| `GET` | `/templates/:template_id/clone/new` | `templates_clone#new` | Clone confirmation page | todo |
| `POST` | `/templates/:template_id/clone` | `templates_clone#create` | Perform template clone | todo |
| `GET` | `/templates/:template_id/debug` | `templates_debug#show` | Debug template documents *(dev only)* | todo |
| `GET` | `/templates/:template_id/documents` | `template_documents#index` | List template documents/pages | todo |
| `POST` | `/templates/:template_id/documents` | `template_documents#create` | Add/replace document in template | todo |
| `POST` | `/templates/:template_id/clone_and_replace` | `templates_clone_and_replace#create` | Clone template replacing its document | todo |
| `POST` | `/templates/:template_id/detect_fields` | `templates_detect_fields#create` | Auto-detect fields in template document *(non-multitenant)* | todo |
| `POST` | `/templates/:template_id/restore` | `templates_restore#create` | Restore archived template | todo |
| `GET` | `/templates/:template_id/archived` | `templates_archived_submissions#index` | Archived submissions of this template | todo |
| `GET` | `/templates/:template_id/submissions/new` | `submissions#new` | New submission page for template | todo |
| `POST` | `/templates/:template_id/submissions` | `submissions#create` | Create submission(s) from template (incl. spreadsheet import) | todo |
| `GET` | `/templates/:template_id/folder/edit` | `templates_folders#edit` | Move template to folder (edit view) | todo |
| `PATCH/PUT` | `/templates/:template_id/folder` | `templates_folders#update` | Assign template folder | todo |
| `GET` | `/templates/:template_id/preview` | `templates_preview#show` | Document preview iframe content | todo |
| `GET` | `/templates/:template_id/form` | `templates_form_preview#show` | Preview of the signer form | todo |
| `GET` | `/templates/:template_id/code_modal` | `templates_code_modal#show` | Embed code snippet modal | todo |
| `GET` | `/templates/:template_id/preferences` | `templates_preferences#show` | Template preferences modal | todo |
| `POST` | `/templates/:template_id/preferences` | `templates_preferences#create` | Save template preferences (name/message/roles) | todo |
| `DELETE` | `/templates/:template_id/preferences` | `templates_preferences#destroy` | Reset/clear template preferences | todo |
| `GET` | `/templates/:template_id/versions` | `templates_versions#index` | Template version history list | todo |
| `GET` | `/templates/:template_id/versions/:id` | `templates_versions#show` | View specific template version | todo |
| `POST` | `/templates/:template_id/versions` | `templates_versions#create` | Create new template version snapshot | todo |
| `GET` | `/templates/:template_id/share_link` | `templates_share_link#show` | Shareable link modal | todo |
| `POST` | `/templates/:template_id/share_link` | `templates_share_link#create` | Generate share link for template | todo |
| `GET` | `/templates/:template_id/share_link_qr` | `templates_share_link_qr#show` | QR code image for share link | todo |
| `POST` | `/templates/:template_id/recipients` | `templates_recipients#create` | Bulk-update template recipients/roles | todo |
| `POST` | `/templates/:template_id/prefillable_fields` | `templates_prefillable_fields#create` | Mark fields as API-prefillable | todo |
| `GET` | `/templates/:template_id/submissions_export` | `submissions_export#index` | Export submissions data/CSV | todo |
| `GET` | `/templates/:template_id/submissions_export/new` | `submissions_export#new` | Export options page | todo |
| `GET` | `/folders/:id` | `template_folders#show` | Folder contents view | todo |
| `GET` | `/folders/:id/edit` | `template_folders#edit` | Rename folder view | todo |
| `PATCH/PUT` | `/folders/:id` | `template_folders#update` | Update folder name | todo |
| `DELETE` | `/folders/:id` | `template_folders#destroy` | Delete folder (keeps templates) | todo |
| `GET` | `/template_folders_autocomplete` | `template_folders_autocomplete#index` | Folder name autocomplete search | todo |
| `POST` | `/template_sharings_testing` | `template_sharings_testing#create` | Test shared template link (QA feature) | todo |

### Submissions & submitters

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/submissions` | `submissions_dashboard#index` | Submissions list dashboard | todo |
| `GET` | `/submissions/archived` | `submissions_archived#index` | Archived submissions list | todo |
| `GET` | `/submissions_filters/:name` | `submissions_filters#show` | Saved submission filter results | todo |
| `GET` | `/submissions/:id` | `submissions#show` | Submission detail page | todo |
| `DELETE` | `/submissions/:id` | `submissions#destroy` | Archive submission | todo |
| `POST` | `/submissions/:submission_id/unarchive` | `submissions_unarchive#create` | Restore archived submission | todo |
| `GET` | `/submissions/:submission_id/events` | `submission_events#index` | Submission audit trail page | todo |
| `GET` | `/submissions/:submission_id/download` | `submissions_download#index` | Download merged submission documents | todo |
| `POST` | `/submissions/:submission_id/resend_email` | `submissions_resend_email#create` | Re-sign/resend signing emails | todo |
| `GET` | `/submitters/:id/edit` | `submitters#edit` | Edit submitter details (admin view) | todo |
| `PATCH/PUT` | `/submitters/:id` | `submitters#update` | Update submitter (resends email/SMS when changed) | todo |
| `GET` | `/submitters_autocomplete` | `submitters_autocomplete#index` | Submitter autocomplete search | todo |
| `PATCH/PUT` | `/submitters_resubmit/:id` | `submitters_resubmit#update` | Re-open completed submitter for re-signing | todo |
| `POST` | `/send_submission_email` | `send_submission_email#create` | Send custom email with attached signed docs | todo |

### Public signing flows (`/d`, `/s`, `/p`, `/e`)

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/d/:slug` | `start_form#show` | Public start-form page (begin signing from template link) | todo |
| `PATCH/PUT` | `/d/:slug` | `start_form#update` | Submit started form (creates submission, sends invites) | todo |
| `GET` | `/d/:slug/completed` | `start_form#completed` | Completion page for started form | todo |
| `PATCH/PUT` | `/resubmit_form` | `start_form#update` | Re-run start form for existing submitter | todo |
| `POST` | `/start_form_email_2fa_send` | `start_form_email_2fa_send#create` | Send/resend email verification code on start form | todo |
| `GET` | `/s/:slug` | `submit_form#show` | Public signer form page (with optional email 2FA gate) | todo |
| `PATCH/PUT` | `/s/:slug` | `submit_form#update` | Save signer field values/attachments | todo |
| `GET` | `/s/:slug/completed` | `submit_form#completed` | Signed completion page for submitter | todo |
| `GET` | `/s/:slug/delegated` | `submit_form#delegated` | Page shown after delegating to another signer | todo |
| `GET` | `/s/:slug/values` | `submit_form_values#index` | Poll saved signer values (live sync) | todo |
| `GET` | `/s/:slug/download` | `submit_form_download#index` | Download in-progress/completed documents per submitter | todo |
| `GET` | `/s/:slug/documents` | `submit_form_completed_download#index` | Download completed documents by submitter slug | todo |
| `POST` | `/s/:slug/decline` | `submit_form_decline#create` | Decline to sign | todo |
| `POST` | `/s/:slug/delegate` | `submit_form_delegate#create` | Delegate signing to another person | todo |
| `POST` | `/s/:slug/invite` | `submit_form_invite#create` | Invite additional submitters from the form | todo |
| `GET` | `/s/:slug/metadata` | `submit_form_metadata#index` | Form metadata for signer UI | todo |
| `GET` | `/s/:slug/debug` | `submissions_debug#index` | Debug submission state *(dev only)* | todo |
| `GET` | `/success` | `submit_form#success` | Generic post-submission success page | todo |
| `GET` | `/p/:slug` | `submit_form_draw_signature#show` | Standalone drawn-signature pad page | todo |
| `GET` | `/e/:slug` | `submissions_preview#show` | Public preview page of a prepared submission | todo |
| `GET` | `/e/:slug/completed` | `submissions_preview#completed` | Completed view of previewed submission | todo |
| `GET` | `/e/:slug/download` | `submissions_preview_download#index` | Download documents from preview link | todo |
| `POST` | `/submit_form_email_2fa` | `submit_form_email_2fas#create` | Verify email one-time code to unlock signer form | todo |
| `PATCH/PUT` | `/submit_form_email_2fa` | `submit_form_email_2fas#update` | Resend email verification code for signer form | todo |

### Users, signature & initials

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/users/new` | `users#new` | Invite/add user page | todo |
| `POST` | `/users` | `users#create` | Create/invite user | todo |
| `GET` | `/users/:id/edit` | `users#edit` | Edit user page | todo |
| `PATCH/PUT` | `/users/:id` | `users#update` | Update user role/team/status | todo |
| `DELETE` | `/users/:id` | `users#destroy` | Archive (soft-delete) user | todo |
| `PATCH/PUT` | `/users/:user_id/send_reset_password` | `users_send_reset_password#update` | Admin-triggered password reset email | todo |
| `GET` | `/user_signature/edit` | `user_signatures#edit` | Edit personal signature image | todo |
| `PATCH/PUT` | `/user_signature` | `user_signatures#update` | Upload/update signature image | todo |
| `DELETE` | `/user_signature` | `user_signatures#destroy` | Remove signature image | todo |
| `GET` | `/user_initials/edit` | `user_initials#edit` | Edit personal initials image | todo |
| `PATCH/PUT` | `/user_initials` | `user_initials#update` | Upload/update initials image | todo |
| `DELETE` | `/user_initials` | `user_initials#destroy` | Remove initials image | todo |

### Account & user configs

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `POST` | `/account_configs` | `account_configs#create` | Save account-level config key/value | todo |
| `DELETE` | `/account_configs/:id` | `account_configs#destroy` | Delete account-level config key | todo |
| `POST` | `/account_custom_fields` | `account_custom_fields#create` | Add account custom field definition | todo |
| `POST` | `/user_configs` | `user_configs#create` | Save current-user config key/value | todo |
| `DELETE` | `/encrypted_user_configs/:id` | `encrypted_user_configs#destroy` | Delete encrypted (e.g. SMTP/SSO secret) config | todo |

### MFA / email 2FA setup

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/mfa_setup/new` | `mfa_setup#new` | Start TOTP 2FA setup (provisioning URI/QR) | todo |
| `POST` | `/mfa_setup` | `mfa_setup#create` | Confirm TOTP code and enable 2FA | todo |
| `GET` | `/mfa_setup` | `mfa_setup#show` | Show 2FA status/setup intro | todo |
| `GET` | `/mfa_setup/edit` | `mfa_setup#edit` | Disable-2FA dialog (code confirm) | todo |
| `DELETE` | `/mfa_setup` | `mfa_setup#destroy` | Disable TOTP 2FA after code check | todo |

### Console redirects & testing

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/console_redirect` | `console_redirect#index` | Redirect into cloud console with signed token | todo |
| `GET` | `/upgrade` | `console_redirect#index` | Redirect to console upgrade page | todo |
| `GET` | `/manage` | `console_redirect#index` | Redirect to console management page | todo |
| `POST` | `/testing_account` | `testing_accounts#create` | Spin up testing/demo account (QA) | todo |
| `DELETE` | `/testing_account` | `testing_accounts#destroy` | Tear down testing account (QA) | todo |
| `GET` | `/testing_api_settings` | `testing_api_settings#index` | Testing API keys info page (QA) | todo |

### Stripe Connect OAuth

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `POST` | `/auth/stripe_connect` | `stripe_connect#create` | Begin Stripe Connect OAuth flow | todo |
| `GET` | `/auth/stripe_connect/callback` | `stripe_connect#callback` | Stripe OAuth callback handler | todo |

### Settings

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/settings/storage` | `storage_settings#index` | Storage provider settings page *(non-multitenant)* | todo |
| `POST` | `/settings/storage` | `storage_settings#create` | Save storage (S3/Azure/GCS) credentials *(non-multitenant)* | todo |
| `POST` | `/settings/search_entries_reindex` | `search_entries_reindex#create` | Trigger full-text re-index job *(non-multitenant)* | todo |
| `GET` | `/settings/sms` | `sms_settings#index` | SMS provider settings page *(non-multitenant)* | todo |
| `GET` | `/settings/mcp` | `mcp_settings#index` | MCP tokens list page *(non-multitenant)* | todo |
| `GET` | `/settings/mcp/new` | `mcp_settings#new` | New MCP token page *(non-multitenant)* | todo |
| `POST` | `/settings/mcp` | `mcp_settings#create` | Create MCP token *(non-multitenant)* | todo |
| `DELETE` | `/settings/mcp/:id` | `mcp_settings#destroy` | Revoke MCP token *(non-multitenant)* | todo |
| `GET` | `/settings/api` | `api_settings#index` | API access token page *(demo or non-multitenant)* | todo |
| `POST` | `/settings/api` | `api_settings#create` | Regenerate API access token *(demo or non-multitenant)* | todo |
| `GET` | `/settings/reveal_access_token` | `reveal_access_token#show` | Reveal-masked access token view *(demo or non-multitenant)* | todo |
| `POST` | `/settings/reveal_access_token` | `reveal_access_token#create` | Reveal token value after auth check *(demo or non-multitenant)* | todo |
| `GET` | `/settings/email` | `email_smtp_settings#index` | SMTP email settings page | todo |
| `POST` | `/settings/email` | `email_smtp_settings#create` | Save/test SMTP credentials | todo |
| `GET` | `/settings/sso` | `sso_settings#index` | SSO/SAML/OIDC settings page | todo |
| `GET` | `/settings/notifications` | `notifications_settings#index` | Notification preferences page | todo |
| `POST` | `/settings/notifications` | `notifications_settings#create` | Save BCC/reminders notification prefs | todo |
| `GET` | `/settings/esign/new` | `esign_settings#new` | Upload e-signature certificate form | todo |
| `POST` | `/settings/esign` | `esign_settings#create` | Add e-signature certificate (HSM/P12) | todo |
| `GET` | `/settings/esign` | `esign_settings#show` | E-signature certificate status page | todo |
| `GET` | `/settings/esign/edit` | `esign_settings#edit` | Replace certificate view | todo |
| `PATCH/PUT` | `/settings/esign` | `esign_settings#update` | Update e-signature certificate | todo |
| `DELETE` | `/settings/esign` | `esign_settings#destroy` | Remove e-signature certificate | todo |
| `GET` | `/settings/payments` | `stripe_settings#index` | Stripe payment integration settings page | todo |
| `POST` | `/settings/payments` | `stripe_settings#create` | Save Stripe publishable/secret keys | todo |
| `DELETE` | `/settings/payments` | `stripe_settings#destroy` | Disconnect Stripe keys | todo |
| `GET` | `/settings/docusign` | `docusign_settings#index` | DocuSign import/integration settings page | todo |
| `POST` | `/settings/docusign` | `docusign_settings#create` | Save DocuSign API credentials | todo |
| `DELETE` | `/settings/docusign` | `docusign_settings#destroy` | Remove DocuSign credentials | todo |
| `GET` | `/settings/docusign_import` | `docusign_import#index` | DocuSign templates/envelopes import page | todo |
| `POST` | `/settings/docusign_import` | `docusign_import#create` | Run DocuSign import job | todo |
| `GET` | `/settings/docusign_import/oauth_callback` | `docusign_import#oauth_callback` | DocuSign OAuth callback | todo |
| `DELETE` | `/settings/docusign_import/disconnect` | `docusign_import#disconnect` | Disconnect DocuSign OAuth grant | todo |
| `GET` | `/settings/users` | `users#index` | Team users management table | todo |
| `GET` | `/settings/users/:status` | `users#index` | Archived users list (`status=archived`) | todo |
| `GET` | `/settings/users/:status` | `users#index` | Integration users list (`status=integration`) | todo |
| `GET` | `/settings/teams` | `teams#index` | Teams list page | todo |
| `GET` | `/settings/teams/new` | `teams#new` | New team page/modal | todo |
| `POST` | `/settings/teams` | `teams#create` | Create team | todo |
| `GET` | `/settings/teams/:id/edit` | `teams#edit` | Edit team members page | todo |
| `PATCH/PUT` | `/settings/teams/:id` | `teams#update` | Update team name/members | todo |
| `DELETE` | `/settings/teams/:id` | `teams#destroy` | Delete team | todo |
| `GET` | `/settings/personalization` | `personalization_settings#show` | Branding/personalization settings modal | todo |
| `POST` | `/settings/personalization` | `personalization_settings#create` | Save branding colors/logo/app name | todo |
| `POST` | `/settings/company_logo` | `company_logo_settings#create` | Upload company logo | todo |
| `DELETE` | `/settings/company_logo` | `company_logo_settings#destroy` | Remove company logo | todo |
| `GET` | `/settings/account` | `accounts#show` | Account settings page | todo |
| `PATCH/PUT` | `/settings/account` | `accounts#update` | Update account name/app URL | todo |
| `DELETE` | `/settings/account` | `accounts#destroy` | Archive whole account | todo |
| `GET` | `/settings/profile` | `profile#index` | Current-user profile page | todo |
| `PATCH` | `/settings/profile/update_contact` | `profile#update_contact` | Change profile name/email | todo |
| `PATCH` | `/settings/profile/update_password` | `profile#update_password` | Change own password | todo |
| `PATCH` | `/settings/profile/update_app_url` | `profile#update_app_url` | Update preferred app URL | todo |
| `POST` | `/timestamp_server` | `timestamp_server#create` | Test/save RFC3161 timestamp server config *(non-multitenant)* | todo |

## Devise/auth

Generated by `devise_for :users, path: '/', only: %i[sessions passwords]` with custom `sessions`/`passwords` controllers.

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/sign_in` | `sessions#new` | Login page | todo |
| `POST` | `/sign_in` | `sessions#create` | Authenticate (password + optional OTP step) | todo |
| `DELETE` | `/sign_out` | `sessions#destroy` | Sign out (session cookie cleared) | todo |
| `GET` | `/password/new` | `passwords#new` | Request password reset form | todo |
| `POST` | `/password` | `passwords#create` | Email password-reset instructions (6h token) | todo |
| `GET` | `/password/edit` | `passwords#edit` | Reset password form via reset token | todo |
| `PATCH/PUT` | `/password` | `passwords#update` | Set new password from reset token | todo |
| `GET` | `/invitation` | `invitations#edit` | Accept invitation / set initial password form | todo |
| `PATCH/PUT` | `/invitation` | `invitations#update` | Save invited user's password (+ confirm account) | todo |

## ActiveStorage/uploads

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `GET` | `/file/:signed_uuid/*filename` | `api/active_storage_blobs_proxy#show` | Signed proxy stream/download of any attachment blob | todo |
| `GET` | `/blobs_proxy/:signed_uuid/*filename` | `api/active_storage_blobs_proxy#show` | Same blob proxy under explicit path | todo |
| `GET` | `/blobs/proxy/:signed_id/*filename` | `api/active_storage_blobs_proxy_legacy#show` | Legacy signed-id blob proxy *(multitenant)* | todo |
| `GET` | `/disk/:encoded_key/*filename` | `active_storage/disk#show` | Disk service file streaming *(multitenant)* | todo |
| `PUT` | `/disk/:encoded_token` | `active_storage/disk#update` | Disk service upload/update *(multitenant)* | todo |
| `POST` | `/direct_uploads` | `active_storage/direct_uploads#create` | Direct-to-service blob upload init *(multitenant)* | todo |
| `GET` | `/rails/active_storage/blobs/redirect/:signed_id/*filename` | `active_storage/blobs/redirect#show` | AS engine blob redirect *(non-multitenant, engine)* | todo |
| `GET` | `/rails/active_storage/blobs/proxy/:signed_id/*filename` | `active_storage/blobs/proxy#show` | AS engine proxied blob stream *(non-multitenant, engine)* | todo |
| `GET` | `/rails/active_storage/representations/redirect/:signed_id/:variation_key/*filename` | `active_storage/representations/redirect#show` | AS engine variant redirect *(non-multitenant, engine)* | todo |
| `GET` | `/rails/active_storage/representations/proxy/:signed_id/:variation_key/*filename` | `active_storage/representations/proxy#show` | AS engine proxied variant *(non-multitenant, engine)* | todo |
| `GET` | `/rails/active_storage/disk/:encoded_key/*filename` | `active_storage/disk#show` | AS engine disk service stream *(non-multitenant, engine)* | todo |
| `PUT/PATCH/POST` | `/rails/active_storage/disk/:encoded_token` | `active_storage/disk#update` | AS engine disk service upload *(non-multitenant, engine)* | todo |
| `POST` | `/rails/active_storage/direct_uploads` | `active_storage/direct_uploads#create` | AS engine direct uploads *(non-multitenant, engine)* | todo |
| `GET` | `/preview/:signed_key` | `preview_document_page#show` | Render single document page image via signed key | todo |
| `POST` | `/upload_spreadsheet` | `upload_spreadsheet#create` | Parse CSV/XLSX into bulk-submission rows | todo |
| `POST` | `/templates_upload` | `templates_uploads#create` | Create template from uploaded file/URL | todo |
| `GET` | `/new` | `templates_uploads#show` | Template upload wizard page (authenticated) | todo |

> API file upload lives at `POST /api/attachments` (see API group). In non-multitenant mode the ActiveStorage engine draws default `/rails/active_storage/*` routes; in multitenant mode engine routes are disabled and replaced by the manual ones above.

## Webhooks

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `POST` | `/api/stripe_webhooks` | `api/stripe_connect#webhook` | Stripe webhook receiver (checkout/payment events) | todo |
| `GET` | `/webhook_secret/:id` | `webhook_secret#show` | Show computed webhook signing secret | todo |
| `PATCH/PUT` | `/webhook_secret/:id` | `webhook_secret#update` | Rotate/regenerate webhook secret | todo |
| `GET` | `/webhook_hmac/:id` | `webhook_hmac#show` | Show HMAC key info for webhook signing | todo |
| `PATCH/PUT` | `/webhook_preferences/:id` | `webhook_preferences#update` | Update per-user webhook preferences | todo |
| `GET` | `/settings/webhooks` | `webhook_settings#index` | Webhooks list page | todo |
| `GET` | `/settings/webhooks/new` | `webhook_settings#new` | New webhook form/modal | todo |
| `POST` | `/settings/webhooks` | `webhook_settings#create` | Create webhook endpoint | todo |
| `GET` | `/settings/webhooks/:id` | `webhook_settings#show` | Webhook details + delivery log | todo |
| `GET` | `/settings/webhooks/:id/edit` | `webhook_settings#edit` | Edit webhook form | todo |
| `PATCH/PUT` | `/settings/webhooks/:id` | `webhook_settings#update` | Update webhook URL/events/enabled flag | todo |
| `DELETE` | `/settings/webhooks/:id` | `webhook_settings#destroy` | Delete webhook endpoint | todo |
| `POST` | `/settings/webhooks/:webhook_id/resend` | `webhook_settings#resend` | Manually resend webhook events | todo |
| `GET` | `/settings/webhooks/:webhook_id/events/:id` | `webhook_events#show` | Single webhook event/delivery detail | todo |
| `POST` | `/settings/webhooks/:webhook_id/events/:id/resend` | `webhook_events#resend` | Resend one webhook event | todo |
| `POST` | `/settings/webhooks/:webhook_id/events/:id/refresh` | `webhook_events#refresh` | Refresh event status from provider | todo |

## Other (engine mounts)

| Method | Rails path | Controller#action | Purpose (1-line) | Port status |
|---|---|---|---|---|
| `ANY` | `/letter_opener/*path` | LetterOpenerWeb::Engine | Dev-only sent-email viewer mount *(dev only)* | todo |
| `ANY` | `/jobs/*path` | Sidekiq::Web (mount) | Sidekiq dashboard for admin/sidekiq users *(non-multitenant)* | todo |

---

## Auth inventory

Source: `config/initializers/devise.rb`, `app/models/user.rb`, `sessions_controller.rb`, `passwords_controller.rb`, `invitations_controller.rb`, `mfa_setup_controller.rb`.

**Devise modules on `User`:**
`two_factor_authenticatable` (devise-two-factor TOTP gem; includes password/database authentication), `recoverable`, `rememberable`, `validatable`, `trackable`, `lockable`.
Not present: `registerable` (sign-up happens via first-run `/setup` and admin invites), `confirmable` module (`invitations#update` sets `confirmed_at` manually), `timeoutable` (no idle session expiry), `omniauthable` (**no OAuth login providers**; `/auth/stripe_connect` is Stripe Connect for payments only, DocuSign OAuth is import-only).

**Session strategy:**
Warden cookie-session via custom `SessionsController < Devise::SessionsController`; routes mounted at path `/` so login is `GET|POST /sign_in`, logout `DELETE /sign_out` (sign_out_via: :delete). Warden default strategy list has `:two_factor_authenticatable` unshifted to the front. Custom `FailureApp` reports invalid-password attempts to Rollbar. Email auth key is case-insensitive with whitespace stripped. Remember-me forced on (`User#remember_me` always true), `remember_for = SESSION_REMEMBER_DAYS || 730 days`; all remember tokens expire on sign-out. Password hashing cost 10 bcrypt stretches (1 in test). Turbo-compatible responder statuses configured.

**2FA methods present:**
1. TOTP authenticator apps via devise-two-factor: columns `otp_secret` / `otp_required_for_login`, allowed drift 60s. Login intercepts in `sessions#create`: if the user has OTP enabled and no `otp_attempt` param, renders an OTP step before Devise's `super`. Enable/disable flows live in `MfaSetupController` (provisioning URI + QR, code confirmation, disable requires valid current code).
2. Email one-time-code 2FA for public form links (not account login): `SubmitFormEmail2fasController#create/update` verifies a numeric code against `EmailVerificationCodes` then sets a 12h encrypted `email_2fa_slug` cookie; codes are sent/resend by `StartFormEmail2faSendController` and background job `SendSubmitterVerificationEmailJob`; both rate-limited (2 attempts / 45s).

**Password reset flow:**
Devise `recoverable` through custom `PasswordsController < Devise::PasswordsController`: `POST /password` emails reset link, token valid `reset_password_within = 6 hours`, `GET/PATCH /password/edit` sets new password. Auto sign-in after reset is conditional: `User.sign_in_after_reset_password` returns false when the resetting user has OTP enabled (avoids skipping the second factor). Admins can trigger resets per user via `users_send_reset_password#update`. Invitation acceptance reuses the password-reset machinery: `InvitationsController < Devise::PasswordsController` (update also confirms the account). `validatable` enforces password length 6..128.

**Locking/other:**
`:lockable` included (columns `failed_attempts`, `locked_at`, `unlock_token`) with Devise defaults (lock after failed attempts, unlock by email/time). Archiving blocks login via `active_for_authentication?` (user or account archived). No HTTP-basic auth; `skip_session_storage = [:http_auth]`.

---

### Porting notes

- Route expansion was done manually from `config/routes.rb` because `rails routes` could not run in this environment (Ruby version mismatch); every controller file referenced was verified to exist under `app/controllers/**`.
- Rows marked *(engine)* come from the ActiveStorage engine, not `routes.rb` itself.
- API defaults to JSON format; embed namespace is CORS-enabled and JWT-scoped (`embed_tokens`).
