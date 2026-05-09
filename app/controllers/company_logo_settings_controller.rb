# frozen_string_literal: true

class CompanyLogoSettingsController < ApplicationController
  before_action :load_account

  authorize_resource :account

  def create
    @account.company_logo.attach(params[:logo]) if params[:logo].present?

    redirect_to settings_personalization_path, notice: I18n.t('settings_have_been_saved')
  end

  def destroy
    @account.company_logo.purge

    redirect_to settings_personalization_path, notice: I18n.t('settings_have_been_saved')
  end

  private

  def load_account
    @account = current_account
  end
end
