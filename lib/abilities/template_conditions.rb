# frozen_string_literal: true

module Abilities
  module TemplateConditions
    module_function

    def collection(user, ability: nil)
      templates = Template.where(account_id: user.account_id)

      # Scope by team for non-admin users with a team assigned
      if user.team_id.present? && !user.admin?
        team_user_ids = User.where(team_id: user.team_id, account_id: user.account_id).select(:id)
        templates = templates.where(author_id: [nil, *team_user_ids])
      end

      return templates unless user.account.testing?

      shared_ids =
        TemplateSharing.where({ ability:, account_id: [user.account_id, TemplateSharing::ALL_ID] }.compact)
                       .select(:template_id)

      Template.where(Template.arel_table[:id].in(templates.select(:id).arel.union(:all, shared_ids.arel)))
    end

    def entity(template, user:, ability: nil)
      return true if template.account_id.blank?

      if template.account_id == user.account_id
        # Enforce team scoping for non-admin users with a team
        if user.team_id.present? && !user.admin?
          return true if template.author_id.nil?

          team_user_ids = User.where(team_id: user.team_id, account_id: user.account_id).pluck(:id)
          return team_user_ids.include?(template.author_id)
        end

        return true
      end
      return false unless user.account.linked_account_account
      return false if template.template_sharings.to_a.blank?

      account_ids = [user.account_id, TemplateSharing::ALL_ID]

      template.template_sharings.to_a.any? do |e|
        e.account_id.in?(account_ids) && (ability.nil? || e.ability == 'manage' || e.ability == ability)
      end
    end
  end
end
