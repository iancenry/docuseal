# frozen_string_literal: true

class Ability
  include CanCan::Ability

  def initialize(user)
    case user.role
    when User::ADMIN_ROLE, 'integration'
      admin_abilities(user)
    when User::EDITOR_ROLE
      editor_abilities(user)
    when User::VIEWER_ROLE
      viewer_abilities(user)
    else
      admin_abilities(user)
    end
  end

  private

  def admin_abilities(user)
    can %i[read create update], Template, Abilities::TemplateConditions.collection(user) do |template|
      Abilities::TemplateConditions.entity(template, user:, ability: 'manage')
    end

    can :destroy, Template, account_id: user.account_id
    can :manage, TemplateFolder, account_id: user.account_id
    can :manage, TemplateSharing, template: { account_id: user.account_id }
    can :manage, Submission, account_id: user.account_id
    can :manage, Submitter, account_id: user.account_id
    can :manage, User, account_id: user.account_id
    can :manage, EncryptedConfig, account_id: user.account_id
    can :manage, EncryptedUserConfig, user_id: user.id
    can :manage, AccountConfig, account_id: user.account_id
    can :manage, UserConfig, user_id: user.id
    can :manage, Account, id: user.account_id
    can :manage, AccessToken, user_id: user.id
    can :manage, McpToken, user_id: user.id
    can :manage, WebhookUrl, account_id: user.account_id

    can :manage, :mcp
    can :manage, :reply_to
    can :manage, :personalization_advanced
    can :manage, :bulk_send
    can :manage, :disable_decline
    can :manage, :delegate_form
    can :manage, :saml_sso
    can :manage, :countless
    can :manage, :cfr
    can :manage, :download_users
    can :manage, :tenants
  end

  def editor_abilities(user)
    # Templates: full CRUD
    can %i[read create update], Template, Abilities::TemplateConditions.collection(user) do |template|
      Abilities::TemplateConditions.entity(template, user:, ability: 'manage')
    end
    can :destroy, Template, account_id: user.account_id

    can :manage, TemplateFolder, account_id: user.account_id
    can :manage, TemplateSharing, template: { account_id: user.account_id }

    # Submissions: full CRUD
    can :manage, Submission, account_id: user.account_id
    can :manage, Submitter, account_id: user.account_id

    # Own profile and user-scoped configs
    can :manage, User, id: user.id
    can :manage, EncryptedUserConfig, user_id: user.id
    can :manage, UserConfig, user_id: user.id

    # Read-only account access (for locale, name display, etc.)
    can :read, Account, id: user.account_id

    # Notifications (read own notification settings)
    can :read, AccountConfig, account_id: user.account_id

    # Feature flags editors can use
    can :manage, :bulk_send
    can :manage, :disable_decline
    can :manage, :delegate_form
    can :manage, :countless
  end

  def viewer_abilities(user)
    # Templates: read-only
    can :read, Template, Abilities::TemplateConditions.collection(user) do |template|
      Abilities::TemplateConditions.entity(template, user:, ability: 'read')
    end

    can :read, TemplateFolder, account_id: user.account_id

    # Submissions: read-only
    can :read, Submission, account_id: user.account_id
    can :read, Submitter, account_id: user.account_id

    # Own profile
    can :manage, User, id: user.id
    can :manage, EncryptedUserConfig, user_id: user.id
    can :manage, UserConfig, user_id: user.id

    # Read-only account access
    can :read, Account, id: user.account_id

    can :manage, :countless
  end
end
