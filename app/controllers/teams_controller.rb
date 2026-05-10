# frozen_string_literal: true

class TeamsController < ApplicationController
  load_and_authorize_resource :team, only: %i[index edit update destroy]

  before_action :build_team, only: %i[new create]
  authorize_resource :team, only: %i[new create]

  def index
    @teams = @teams.active.where(account: current_account).order(id: :desc)

    @pagy, @teams = pagy(@teams)

    @member_counts = User.where(team_id: @teams.map(&:id), archived_at: nil).group(:team_id).count
  end

  def new; end

  def edit; end

  def create
    @team.account = current_account

    if @team.save
      redirect_back fallback_location: settings_teams_path, notice: I18n.t('team_has_been_created')
    else
      render turbo_stream: turbo_stream.replace(:modal, template: 'teams/new'), status: :unprocessable_content
    end
  end

  def update
    if @team.update(team_params)
      update_team_members if params.key?(:team) && params[:team].key?(:user_ids)

      redirect_back fallback_location: settings_teams_path, notice: I18n.t('team_has_been_updated')
    else
      render turbo_stream: turbo_stream.replace(:modal, template: 'teams/edit'), status: :unprocessable_content
    end
  end

  def destroy
    @team.update!(archived_at: Time.current)
    @team.users.update_all(team_id: nil) # rubocop:disable Rails/SkipsModelValidations

    redirect_back fallback_location: settings_teams_path, notice: I18n.t('team_has_been_removed')
  end

  private

  def build_team
    @team = current_account.teams.new(team_params)
  end

  def team_params
    params.fetch(:team, {}).permit(:name, :description)
  end

  def update_team_members
    selected_ids = Array(params.dig(:team, :user_ids)).map(&:to_i)

    # Remove users no longer in team
    @team.users.where.not(id: selected_ids).update_all(team_id: nil) # rubocop:disable Rails/SkipsModelValidations

    # Add newly selected users (only from same account)
    current_account.users.where(id: selected_ids).update_all(team_id: @team.id) # rubocop:disable Rails/SkipsModelValidations
  end
end
