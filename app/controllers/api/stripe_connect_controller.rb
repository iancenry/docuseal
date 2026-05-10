# frozen_string_literal: true

module Api
  class StripeConnectController < ApiBaseController
    skip_before_action :authenticate_user!, only: :webhook
    skip_authorization_check only: :webhook

    authorize_resource :encrypted_config, parent: false, only: %i[show create destroy]

    # GET /api/stripe_connect
    # Check Stripe connection status for current account.
    # Used by template builder UI and tenant backends.
    def show
      config = load_stripe_config

      if config&.value&.dig('secret_key').present?
        render json: {
          status: 'connected',
          publishable_key_present: config.value['publishable_key'].present?,
          webhook_secret_present: config.value['webhook_secret'].present?
        }
      else
        render json: { status: 'not_connected' }
      end
    end

    # POST /api/stripe_connect
    # Configure Stripe keys for current account via API.
    # Tenant backends call this instead of using the Settings UI.
    #
    # Body:
    #   { "secret_key": "sk_live_...", "publishable_key": "pk_live_...", "webhook_secret": "whsec_..." }
    def create
      permitted = params.permit(:secret_key, :publishable_key, :webhook_secret)

      if permitted[:secret_key].blank?
        return render json: { error: 'secret_key is required' }, status: :unprocessable_content
      end

      require 'stripe'
      begin
        Stripe::Account.retrieve({}, { api_key: permitted[:secret_key] })
      rescue Stripe::AuthenticationError
        return render json: { error: 'Invalid Stripe secret key' }, status: :unprocessable_content
      rescue Stripe::StripeError => e
        return render json: { error: "Stripe error: #{e.message}" }, status: :unprocessable_content
      end

      config = EncryptedConfig.find_or_initialize_by(account: current_account, key: EncryptedConfig::STRIPE_KEY)
      existing = config.value || {}
      new_values = permitted.to_h.compact_blank
      config.value = existing.merge(new_values)
      config.save!

      render json: { status: 'connected' }, status: :ok
    end

    # DELETE /api/stripe_connect
    # Remove Stripe configuration for current account.
    def destroy
      config = load_stripe_config
      config&.destroy

      render json: { status: 'removed' }, status: :ok
    end

    # POST /api/stripe_webhooks
    # Stripe webhook endpoint. Verifies signature against all accounts' webhook secrets.
    def webhook
      require 'stripe'

      payload = request.body.read
      sig_header = request.env['HTTP_STRIPE_SIGNATURE']

      event = nil
      matched_config = nil

      EncryptedConfig.where(key: EncryptedConfig::STRIPE_KEY).find_each do |config|
        webhook_secret = config.value&.dig('webhook_secret')
        next if webhook_secret.blank?

        begin
          event = Stripe::Webhook.construct_event(payload, sig_header, webhook_secret)
          matched_config = config
          break
        rescue Stripe::SignatureVerificationError
          next
        end
      end

      unless event
        return render json: { error: 'Invalid signature' }, status: :bad_request
      end

      handle_webhook_event(event, matched_config)

      render json: { received: true }
    rescue JSON::ParserError
      render json: { error: 'Invalid payload' }, status: :bad_request
    end

    private

    def load_stripe_config
      EncryptedConfig.find_by(account: current_account, key: EncryptedConfig::STRIPE_KEY)
    end

    def handle_webhook_event(event, _config)
      case event.type
      when 'checkout.session.completed'
        handle_checkout_completed(event.data.object)
      when 'checkout.session.expired'
        Rails.logger.info("Stripe checkout expired: #{event.data.object.id}")
      end
    end

    def handle_checkout_completed(session)
      return unless session.payment_status == 'paid'

      submitter_slug = session.metadata&.submitter_slug
      return unless submitter_slug

      submitter = Submitter.find_by(slug: submitter_slug)
      return unless submitter

      template = submitter.submission.template
      payment_field = (template.fields || []).find { |f| f['type'] == 'payment' }
      return unless payment_field

      submitter.values ||= {}
      submitter.values[payment_field['uuid']] = session.id
      submitter.save!

      null_warden = Object.new
      null_warden.define_singleton_method(:user) { |*| nil }

      webhook_request = OpenStruct.new(
        remote_ip: '0.0.0.0',
        user_agent: 'Stripe Webhook',
        session: OpenStruct.new(id: ''),
        env: { 'warden' => null_warden }
      )

      SubmissionEvents.create_with_tracking_data(submitter, 'complete_payment', webhook_request)
    end
  end
end
