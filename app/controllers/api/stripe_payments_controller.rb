# frozen_string_literal: true

module Api
  class StripePaymentsController < ApiBaseController
    skip_before_action :authenticate_user!
    skip_authorization_check

    def create
      submitter = Submitter.find_by!(slug: params[:submitter_slug])
      field = find_payment_field(submitter, params[:field_uuid])
      @stripe_config = load_stripe_config(submitter.account)

      return render json: { message: 'Stripe is not configured' }, status: :unprocessable_content unless @stripe_config

      require 'stripe'

      if params[:check_status]
        return handle_status_check(submitter, field)
      end

      session = create_checkout_session(submitter, field, params[:referer])

      render json: { url: session.url }
    rescue Stripe::StripeError => e
      render json: { message: e.message }, status: :unprocessable_content
    end

    def update
      submitter = Submitter.find_by!(slug: params[:submitter_slug])
      @stripe_config = load_stripe_config(submitter.account)

      return render json: { error: 'Stripe is not configured' }, status: :unprocessable_content unless @stripe_config

      require 'stripe'

      session = Stripe::Checkout::Session.retrieve(params[:id], stripe_opts)

      if session.payment_status == 'paid'
        render json: { uuid: session.id, status: 'paid' }
      else
        render json: { error: "Payment not completed (status: #{session.payment_status})" },
               status: :unprocessable_content
      end
    rescue Stripe::StripeError => e
      render json: { error: e.message }, status: :unprocessable_content
    end

    private

    def stripe_opts
      { api_key: @stripe_config['secret_key'] }
    end

    def find_payment_field(submitter, field_uuid)
      template = submitter.submission.template
      fields = template.fields || []
      fields.find { |f| f['uuid'] == field_uuid && f['type'] == 'payment' } ||
        (raise ActiveRecord::RecordNotFound, 'Payment field not found')
    end

    def load_stripe_config(account)
      config = EncryptedConfig.find_by(account:, key: EncryptedConfig::STRIPE_KEY)
      config&.value
    end

    def handle_status_check(submitter, field)
      render json: { url: nil }
    end

    def create_checkout_session(submitter, field, referer)
      preferences = field['preferences'] || {}
      success_url = build_success_url(referer)
      cancel_url = referer || submitter_url(submitter)

      if preferences['payment_link_id'].present?
        create_payment_link_session(preferences, submitter, success_url, cancel_url)
      elsif preferences['price_id'].present?
        create_price_id_session(preferences, submitter, field, success_url, cancel_url)
      else
        create_one_off_session(preferences, submitter, field, success_url, cancel_url)
      end
    end

    def create_payment_link_session(preferences, submitter, success_url, cancel_url)
      payment_link = Stripe::PaymentLink.retrieve(preferences['payment_link_id'], stripe_opts)
      line_items = payment_link.line_items.data.map do |item|
        quantity = calculate_quantity(preferences, submitter)
        { price: item.price.id, quantity: }
      end

      Stripe::Checkout::Session.create({
        line_items:,
        mode: 'payment',
        success_url:,
        cancel_url:,
        customer_email: submitter.email,
        metadata: checkout_metadata(submitter)
      }, stripe_opts)
    end

    def create_price_id_session(preferences, submitter, _field, success_url, cancel_url)
      quantity = calculate_quantity(preferences, submitter)

      Stripe::Checkout::Session.create({
        line_items: [{ price: preferences['price_id'], quantity: }],
        mode: 'subscription',
        success_url:,
        cancel_url:,
        customer_email: submitter.email,
        metadata: checkout_metadata(submitter)
      }, stripe_opts)
    end

    def create_one_off_session(preferences, submitter, field, success_url, cancel_url)
      price = calculate_price(preferences, submitter)
      currency = (preferences['currency'] || 'USD').downcase
      amount = (price.to_f * 100).round

      return Struct.new(:url).new(nil) if amount <= 0

      Stripe::Checkout::Session.create({
        line_items: [{
          price_data: {
            currency:,
            product_data: { name: field['name'].presence || 'Payment' },
            unit_amount: amount
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url:,
        cancel_url:,
        customer_email: submitter.email,
        metadata: checkout_metadata(submitter)
      }, stripe_opts)
    end

    def calculate_price(preferences, submitter)
      if preferences['formula'].present?
        formula = preferences['formula'].gsub(/\{\{(.*?)\}\}/) do
          submitter.values&.dig(::Regexp.last_match(1)) || 0.0
        end
        require 'bigdecimal'
        # Evaluate simple arithmetic only (safe: no eval)
        safe_eval_formula(formula)
      else
        preferences['price'].to_f
      end
    end

    def calculate_quantity(preferences, submitter)
      if preferences['formula'].present?
        quantity = calculate_price(preferences, submitter).to_i
        [quantity, 1].max
      else
        1
      end
    end

    def safe_eval_formula(formula)
      sanitized = formula.to_s.strip
      allowed = /\A[\d\s\+\-\*\/\.\(\)]+\z/
      return 0 unless sanitized.match?(allowed)

      tokens = sanitized.scan(/\d+\.?\d*|[+\-*\/()]/)
      pos = [0]
      result = parse_expression(tokens, pos)
      result.to_f.round(2)
    rescue StandardError
      0
    end

    def parse_expression(tokens, pos)
      left = parse_term(tokens, pos)

      while pos[0] < tokens.length && ['+', '-'].include?(tokens[pos[0]])
        op = tokens[pos[0]]
        pos[0] += 1
        right = parse_term(tokens, pos)
        left = op == '+' ? left + right : left - right
      end

      left
    end

    def parse_term(tokens, pos)
      left = parse_factor(tokens, pos)

      while pos[0] < tokens.length && ['*', '/'].include?(tokens[pos[0]])
        op = tokens[pos[0]]
        pos[0] += 1
        right = parse_factor(tokens, pos)
        left = op == '*' ? left * right : (right.zero? ? BigDecimal('0') : left / right)
      end

      left
    end

    def parse_factor(tokens, pos)
      return BigDecimal('0') if pos[0] >= tokens.length

      token = tokens[pos[0]]

      if token == '('
        pos[0] += 1
        result = parse_expression(tokens, pos)
        pos[0] += 1 if pos[0] < tokens.length && tokens[pos[0]] == ')'
        result
      else
        pos[0] += 1
        BigDecimal(token)
      end
    end

    def checkout_metadata(submitter)
      {
        submitter_slug: submitter.slug,
        submission_id: submitter.submission_id
      }
    end

    def build_success_url(referer)
      return referer if referer.blank?

      separator = referer.include?('?') ? '&' : '?'
      "#{referer}#{separator}stripe_session_id={CHECKOUT_SESSION_ID}"
    end

    def submitter_url(submitter)
      Rails.application.routes.url_helpers.submit_form_url(slug: submitter.slug, host: request.host)
    end
  end
end
