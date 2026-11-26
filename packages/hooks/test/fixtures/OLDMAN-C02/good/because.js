// Users without a team get the default plan because billing needs one.
const plan = user.team?.plan ?? defaultPlan;
