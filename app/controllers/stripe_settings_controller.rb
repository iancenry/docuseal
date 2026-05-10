# frozen_string_literal: true

class StripeSettingsController < ApplicationController
  before_action :load_encrypted_config
  authorize_resource :encrypted_config, only: :index
  authorize_resource :encrypted_config, parent: false, only: %i[create destroy]

  def index; end

  def create
    stripe_params = params.require(:encrypted_config).permit(value: {})
    new_values = stripe_params[:value].to_h
    existing_values = @encrypted_config.value || {}

    # Preserve existing keys when form field is left blank
    merged = existing_values.merge(new_values.compact_blank)

    # If secret_key changed, validate it
    if new_values['secret_key'].present? && new_values['secret_key'] != existing_values['secret_key']
      require 'stripe'
      begin
        Stripe::Account.retrieve({}, { api_key: new_values['secret_key'] })
      rescue Stripe::AuthenticationError
        flash[:alert] = 'Invalid Stripe Secret Key. Please check your API key and try again.'
        return render :index, status: :unprocessable_content
      rescue Stripe::StripeError => e
        flash[:alert] = "Stripe error: #{e.message}"
        return render :index, status: :unprocessable_content
      end
    end

    if @encrypted_config.update(value: merged)
      redirect_to settings_payments_path, notice: I18n.t('changes_have_been_saved')
    else
      render :index, status: :unprocessable_content
    end
  end

  def destroy
    @encrypted_config.destroy

    redirect_to settings_payments_path, notice: 'Stripe configuration has been removed.'
  end

  private

  def load_encrypted_config
    @encrypted_config =
      EncryptedConfig.find_or_initialize_by(account: current_account, key: EncryptedConfig::STRIPE_KEY)
  end
end
