# frozen_string_literal: true

class DocusignImportController < ApplicationController
  skip_authorization_check

  before_action :authorize_admin!

  def index
    config = load_docusign_config

    unless config
      return redirect_to settings_docusign_index_path,
                         alert: I18n.t('please_configure_docusign_first')
    end

    access_token = session[:docusign_access_token]

    unless access_token
      return redirect_to settings_docusign_index_path,
                         alert: I18n.t('please_connect_docusign_account')
    end

    @templates = begin
      DocusignImport.list_templates(config, access_token)
    rescue DocusignImport::ImportError => e
      session.delete(:docusign_access_token)
      session.delete(:docusign_refresh_token)
      flash[:alert] = "DocuSign API error: #{e.message}"
      return redirect_to settings_docusign_index_path
    end

    # Filter out templates already imported
    imported_ids = current_account.templates.where(source: 'docusign_import').pluck(:external_id).compact
    @templates.each { |t| t['imported'] = imported_ids.include?(t['id']) }
  end

  def create
    config = load_docusign_config
    access_token = session[:docusign_access_token]

    unless config && access_token
      return redirect_to settings_docusign_index_path,
                         alert: I18n.t('please_connect_docusign_account')
    end

    template_ids = Array(params[:template_ids]).compact_blank

    if template_ids.empty?
      return redirect_to settings_docusign_import_index_path,
                         alert: I18n.t('please_select_templates_to_import')
    end

    imported = 0
    errors = []

    template_ids.each do |template_id|
      if current_account.templates.exists?(source: 'docusign_import', external_id: template_id)
        errors << "Template #{template_id} already imported"
        next
      end

      DocusignImport.import_template(
        config, access_token, template_id,
        account: current_account,
        author: current_user
      )
      imported += 1
    rescue DocusignImport::ImportError => e
      errors << e.message
    end

    notice = I18n.t('templates_imported', count: imported)
    notice += " (#{errors.size} errors)" if errors.any?

    redirect_to root_path, notice: notice
  end

  def oauth_callback
    config = load_docusign_config

    unless config
      return redirect_to settings_docusign_index_path,
                         alert: I18n.t('please_configure_docusign_first')
    end

    code = params[:code]

    unless code.present?
      return redirect_to settings_docusign_index_path,
                         alert: 'OAuth authorization failed. Please try again.'
    end

    token_data = DocusignImport.exchange_code(config.merge('redirect_uri' => oauth_callback_settings_docusign_import_index_url), code)

    session[:docusign_access_token] = token_data['access_token']
    session[:docusign_refresh_token] = token_data['refresh_token']

    # Fetch user info to get account_id if not configured
    if config['account_id'].blank?
      user_info = DocusignImport.user_info(config, token_data['access_token'])
      account = user_info.dig('accounts')&.find { |a| a['is_default'] } || user_info.dig('accounts', 0)

      if account
        config['account_id'] = account['account_id']
        ec = EncryptedConfig.find_or_initialize_by(account: current_account, key: EncryptedConfig::DOCUSIGN_KEY)
        ec.update!(value: config)
      end
    end

    redirect_to settings_docusign_import_index_path, notice: I18n.t('docusign_connected_successfully')
  rescue DocusignImport::ImportError => e
    redirect_to settings_docusign_index_path, alert: "DocuSign error: #{e.message}"
  end

  def disconnect
    session.delete(:docusign_access_token)
    session.delete(:docusign_refresh_token)

    redirect_to settings_docusign_index_path, notice: I18n.t('docusign_disconnected')
  end

  private

  def load_docusign_config
    ec = EncryptedConfig.find_by(account: current_account, key: EncryptedConfig::DOCUSIGN_KEY)
    return nil unless ec&.value.is_a?(Hash) && ec.value['client_id'].present?

    ec.value
  end

  def authorize_admin!
    authorize! :manage, EncryptedConfig
  end
end
