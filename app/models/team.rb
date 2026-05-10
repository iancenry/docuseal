# frozen_string_literal: true

# == Schema Information
#
# Table name: teams
#
#  id          :bigint           not null, primary key
#  archived_at :datetime
#  description :text
#  name        :string           not null
#  created_at  :datetime         not null
#  updated_at  :datetime         not null
#  account_id  :bigint           not null
#
# Indexes
#
#  index_teams_on_account_id           (account_id)
#  index_teams_on_account_id_and_name  (account_id,name) UNIQUE WHERE (archived_at IS NULL)
#
# Foreign Keys
#
#  fk_rails_...  (account_id => accounts.id)
#
class Team < ApplicationRecord
  belongs_to :account

  has_many :users, dependent: :nullify

  attribute :name, :string

  scope :active, -> { where(archived_at: nil) }
  scope :archived, -> { where.not(archived_at: nil) }

  validates :name, presence: true
  validates :name, uniqueness: { scope: :account_id, conditions: -> { where(archived_at: nil) } }
end
