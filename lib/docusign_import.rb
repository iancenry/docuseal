# frozen_string_literal: true

module DocusignImport
  BASE_URLS = {
    'production' => 'https://na1.docusign.net',
    'demo' => 'https://demo.docusign.net'
  }.freeze

  AUTH_URLS = {
    'production' => 'https://account.docusign.com',
    'demo' => 'https://account-d.docusign.com'
  }.freeze

  ImportError = Class.new(StandardError)

  TAB_TYPE_MAP = {
    'signHereTabs' => 'signature',
    'initialHereTabs' => 'initials',
    'textTabs' => 'text',
    'dateTabs' => 'date',
    'dateSignedTabs' => 'date',
    'checkboxTabs' => 'checkbox',
    'numberTabs' => 'number',
    'listTabs' => 'select',
    'fullNameTabs' => 'text',
    'emailTabs' => 'text',
    'companyTabs' => 'text',
    'titleTabs' => 'text',
    'noteTabs' => 'text'
  }.freeze

  module_function

  def auth_url(config)
    env = config['environment'] || 'demo'
    base = AUTH_URLS[env] || AUTH_URLS['demo']

    params = {
      response_type: 'code',
      scope: 'signature',
      client_id: config['client_id'],
      redirect_uri: config['redirect_uri']
    }

    "#{base}/oauth/auth?#{params.to_query}"
  end

  def exchange_code(config, code)
    env = config['environment'] || 'demo'
    base = AUTH_URLS[env] || AUTH_URLS['demo']

    credentials = Base64.strict_encode64("#{config['client_id']}:#{config['client_secret']}")

    resp = Faraday.post("#{base}/oauth/token") do |req|
      req.headers['Authorization'] = "Basic #{credentials}"
      req.headers['Content-Type'] = 'application/x-www-form-urlencoded'
      req.body = URI.encode_www_form(
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: config['redirect_uri']
      )
      req.options.timeout = 15
      req.options.open_timeout = 8
    end

    raise ImportError, "OAuth token exchange failed: #{resp.status}" unless resp.status == 200

    JSON.parse(resp.body)
  end

  def refresh_token(config, token)
    env = config['environment'] || 'demo'
    base = AUTH_URLS[env] || AUTH_URLS['demo']

    credentials = Base64.strict_encode64("#{config['client_id']}:#{config['client_secret']}")

    resp = Faraday.post("#{base}/oauth/token") do |req|
      req.headers['Authorization'] = "Basic #{credentials}"
      req.headers['Content-Type'] = 'application/x-www-form-urlencoded'
      req.body = URI.encode_www_form(
        grant_type: 'refresh_token',
        refresh_token: token
      )
      req.options.timeout = 15
      req.options.open_timeout = 8
    end

    raise ImportError, "Token refresh failed: #{resp.status}" unless resp.status == 200

    JSON.parse(resp.body)
  end

  def user_info(config, access_token)
    env = config['environment'] || 'demo'
    base = AUTH_URLS[env] || AUTH_URLS['demo']

    resp = Faraday.get("#{base}/oauth/userinfo") do |req|
      req.headers['Authorization'] = "Bearer #{access_token}"
      req.options.timeout = 15
      req.options.open_timeout = 8
    end

    raise ImportError, "User info failed: #{resp.status}" unless resp.status == 200

    JSON.parse(resp.body)
  end

  def api_base_url(config)
    env = config['environment'] || 'demo'
    account_id = config['account_id'].to_s.gsub(%r{[^a-zA-Z0-9\-]}, '')

    raise ImportError, 'DocuSign account_id is missing' if account_id.blank?

    base = BASE_URLS[env] || BASE_URLS['demo']

    "#{base}/restapi/v2.1/accounts/#{account_id}"
  end

  def list_templates(config, access_token)
    url = "#{api_base_url(config)}/templates?count=100&order_by=modified&order=desc"

    resp = Faraday.get(url) do |req|
      req.headers['Authorization'] = "Bearer #{access_token}"
      req.headers['Content-Type'] = 'application/json'
      req.options.timeout = 30
      req.options.open_timeout = 8
    end

    raise ImportError, "List templates failed: #{resp.status}" unless resp.status == 200

    data = JSON.parse(resp.body)

    (data['envelopeTemplates'] || []).map do |t|
      {
        'id' => t['templateId'],
        'name' => t['name'],
        'description' => t['description'],
        'created' => t['created'],
        'last_modified' => t['lastModified'],
        'document_count' => t.dig('documents')&.size || 0
      }
    end
  end

  def fetch_template(config, access_token, template_id)
    url = "#{api_base_url(config)}/templates/#{template_id}"

    resp = Faraday.get(url) do |req|
      req.headers['Authorization'] = "Bearer #{access_token}"
      req.headers['Content-Type'] = 'application/json'
      req.options.timeout = 30
      req.options.open_timeout = 8
    end

    raise ImportError, "Fetch template failed: #{resp.status}" unless resp.status == 200

    JSON.parse(resp.body)
  end

  def download_document(config, access_token, template_id, document_id)
    url = "#{api_base_url(config)}/templates/#{template_id}/documents/#{document_id}"

    resp = Faraday.get(url) do |req|
      req.headers['Authorization'] = "Bearer #{access_token}"
      req.options.timeout = 60
      req.options.open_timeout = 8
    end

    raise ImportError, "Download document failed: #{resp.status}" unless resp.status == 200

    resp.body
  end

  def import_template(config, access_token, template_id, account:, author:)
    ds_template = fetch_template(config, access_token, template_id)

    name = ds_template['name'] || 'Imported Template'
    documents = ds_template['documents'] || []
    recipients = ds_template['recipients']&.dig('signers') || []

    # Build submitter mapping: DocuSign recipientId → OpenSeal submitter_uuid
    submitter_map = {}
    submitters = recipients.map do |r|
      uuid = SecureRandom.uuid
      submitter_map[r['recipientId']] = uuid
      { 'name' => r['roleName'].presence || "Party #{r['routingOrder']}", 'uuid' => uuid }
    end

    submitters = [{ 'name' => 'First Party', 'uuid' => SecureRandom.uuid }] if submitters.empty?
    default_submitter_uuid = submitters.first['uuid']

    template = account.templates.new(
      name: name,
      author: author,
      source: 'docusign_import',
      external_id: template_id
    )
    template.submitters = submitters
    template.save!

    schema = []
    all_fields = []

    documents.reject { |d| d['documentId'] == 'certificate' }.each do |doc|
      pdf_data = download_document(config, access_token, template_id, doc['documentId'])
      attachment = store_document(template, pdf_data, doc['name'] || name)

      Templates::ProcessDocument.call(attachment, pdf_data)

      schema << { 'attachment_uuid' => attachment.uuid, 'name' => doc['name'] || attachment.filename.base }

      fields = extract_fields(ds_template, doc['documentId'], attachment, submitter_map, default_submitter_uuid)
      all_fields.concat(fields)
    end

    template.schema = schema
    template.fields = all_fields
    template.save!

    SearchEntries.enqueue_reindex(template)

    template
  rescue StandardError => e
    template&.destroy
    raise ImportError, "Import failed for '#{name}': #{e.message}"
  end

  def store_document(template, pdf_data, doc_name)
    sha256 = Base64.urlsafe_encode64(Digest::SHA256.digest(pdf_data))

    blob = ActiveStorage::Blob.create_and_upload!(
      io: StringIO.new(pdf_data),
      filename: "#{doc_name.to_s.parameterize.presence || 'document'}.pdf",
      content_type: 'application/pdf',
      metadata: { identified: true, analyzed: true, pdf: {}, sha256: sha256 }
    )

    template.documents.create!(blob: blob)
  end

  def extract_fields(ds_template, document_id, attachment, submitter_map, default_submitter_uuid)
    recipients = ds_template.dig('recipients', 'signers') || []
    fields = []

    # Get page dimensions from the attachment metadata
    pdf_metadata = attachment.metadata['pdf'] || {}
    number_of_pages = pdf_metadata['number_of_pages'] || 1

    recipients.each do |recipient|
      tabs = recipient['tabs'] || {}
      submitter_uuid = submitter_map[recipient['recipientId']] || default_submitter_uuid

      TAB_TYPE_MAP.each do |tab_key, field_type|
        (tabs[tab_key] || []).each do |tab|
          next unless tab['documentId'] == document_id

          page = [(tab['pageNumber'].to_i - 1), 0].max
          next if page >= number_of_pages

          field = build_field(tab, field_type, submitter_uuid, attachment, page)
          fields << field if field
        end
      end
    end

    fields
  end

  def build_field(tab, field_type, submitter_uuid, attachment, page)
    # DocuSign uses absolute pixel coords; convert to percentages
    # Standard PDF is 612x792 points (Letter), DocuSign uses 72 DPI
    x_px = tab['xPosition'].to_f
    y_px = tab['yPosition'].to_f
    w_px = tab['width'].to_f.nonzero? || default_width(field_type)
    h_px = tab['height'].to_f.nonzero? || default_height(field_type)

    # Convert to percentage-based coordinates (relative to page)
    # DocuSign coordinates are in points at 72 DPI on a Letter page by default
    page_w = 612.0
    page_h = 792.0

    x_pct = (x_px / page_w * 100).clamp(0, 100)
    y_pct = (y_px / page_h * 100).clamp(0, 100)
    w_pct = (w_px / page_w * 100).clamp(0.5, 100)
    h_pct = (h_px / page_h * 100).clamp(0.5, 100)

    field = {
      'uuid' => SecureRandom.uuid,
      'submitter_uuid' => submitter_uuid,
      'name' => tab['tabLabel'].presence || tab['name'].presence || field_type.titleize,
      'type' => field_type,
      'required' => tab['required'] != 'false',
      'areas' => [{
        'uuid' => SecureRandom.uuid,
        'attachment_uuid' => attachment.uuid,
        'page' => page,
        'x' => x_pct.round(4),
        'y' => y_pct.round(4),
        'w' => w_pct.round(4),
        'h' => h_pct.round(4)
      }]
    }

    if field_type == 'select' && tab['listItems'].is_a?(Array)
      field['options'] = tab['listItems'].map { |i| i['text'] || i['value'] }.compact
    end

    field
  end

  def default_width(field_type)
    case field_type
    when 'signature', 'initials' then 150
    when 'checkbox' then 20
    when 'date' then 120
    else 200
    end
  end

  def default_height(field_type)
    case field_type
    when 'signature', 'initials' then 40
    when 'checkbox' then 20
    else 20
    end
  end
end
