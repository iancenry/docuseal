# frozen_string_literal: true

class SendSubmitterReminderEmailJob
  include Sidekiq::Job

  sidekiq_options queue: 'mailers'

  DURATION_TO_SECONDS = {
    'one_hour' => 1.hour,
    'two_hours' => 2.hours,
    'four_hours' => 4.hours,
    'eight_hours' => 8.hours,
    'twelve_hours' => 12.hours,
    'twenty_four_hours' => 24.hours,
    'two_days' => 2.days,
    'three_days' => 3.days,
    'four_days' => 4.days,
    'five_days' => 5.days,
    'six_days' => 6.days,
    'seven_days' => 7.days,
    'eight_days' => 8.days,
    'fifteen_days' => 15.days,
    'twenty_one_days' => 21.days,
    'thirty_days' => 30.days
  }.freeze

  def perform
    Account.find_each do |account|
      config = AccountConfigs.find_for_account(account, AccountConfig::SUBMITTER_REMINDERS)

      next unless config
      next if config.value.blank?

      durations = parse_durations(config.value)

      next if durations.empty?

      process_account_reminders(account, durations)
    end
  end

  private

  def parse_durations(value)
    %w[first_duration second_duration third_duration].filter_map do |key|
      duration_key = value[key]
      next if duration_key.blank?

      seconds = DURATION_TO_SECONDS[duration_key]
      next unless seconds

      { key:, seconds: }
    end
  end

  def process_account_reminders(account, durations)
    pending_submitters = account.submitters
                                .where(completed_at: nil, declined_at: nil)
                                .where.not(sent_at: nil)
                                .where.not(email: [nil, ''])
                                .joins(:submission)
                                .where(submissions: { archived_at: nil })
                                .preload(:submission, submission: :template)

    pending_submitters.find_each do |submitter|
      next if submitter.template&.archived_at?

      send_reminder_if_due(submitter, durations)
    end
  end

  def send_reminder_if_due(submitter, durations)
    reminder_events = submitter.submission_events.where(event_type: 'send_reminder_email').order(:event_timestamp)
    reminders_sent = reminder_events.count
    last_sent_at = reminder_events.last&.event_timestamp || submitter.sent_at

    durations.each_with_index do |duration, index|
      next if index < reminders_sent
      next unless Time.current >= last_sent_at + duration[:seconds]

      send_reminder(submitter)
      break
    end
  end

  def send_reminder(submitter)
    return unless Accounts.can_send_emails?(submitter.account)

    mail = SubmitterMailer.invitation_reminder_email(submitter)

    Submitters::ValidateSending.call(submitter, mail)

    mail.deliver_now!

    SubmissionEvent.create!(submitter:, event_type: 'send_reminder_email')
  rescue Submitters::ValidateSending::InvalidEmail => e
    Rails.logger.info("Skip reminder for invalid email: #{submitter.id} - #{e.message}")
  end
end
