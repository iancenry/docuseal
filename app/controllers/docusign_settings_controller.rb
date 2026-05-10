# frozen_string_literal: true

class DocusignSettingsController < ApplicationController
  before_action :load_encrypted_config
  authorize_resource :encrypted_config, only: :index
  authorize_resource :encrypted_config, parent: false, only: %i[create destroy]

  def index; end

  def create
    docusign_params = params.require(:encrypted_config).permit(value: {})
    new_values = docusign_params[:value].to_h
    existing_values = @encrypted_config.value || {}

    merged = existing_values.merge(new_values.compact_blank)

    if @encrypted_config.update(value: merged)
      redirect_to settings_docusign_index_path, notice: I18n.t('changes_have_been_saved')
    else
      render :index, status: :unprocessable_content
    end
  end

  def destroy
    @encrypted_config.destroy

    redirect_to settings_docusign_index_path, notice: I18n.t('docusign_configuration_removed')
  end

  private

  def load_encrypted_config
    @encrypted_config =
      EncryptedConfig.find_or_initialize_by(account: current_account, key: EncryptedConfig::DOCUSIGN_KEY)
  end
end
