# frozen_string_literal: true

class CreateTeams < ActiveRecord::Migration[8.0]
  def change
    create_table :teams do |t|
      t.references :account, null: false, foreign_key: true
      t.string :name, null: false
      t.text :description
      t.datetime :archived_at
      t.timestamps
    end

    add_index :teams, %i[account_id name], unique: true, where: 'archived_at IS NULL'

    add_reference :users, :team, foreign_key: true
  end
end
