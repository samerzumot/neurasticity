import math

from brainflow_service.metrics import BandPowerSmoother, BrainFlowScoreSmoother, MetricCalculator, MetricInput, MetricPresentation, compute_band_ratios, compute_protocol_feedback, normalize_brainflow_score, smooth_ema


def test_band_derived_ratios_use_output_smoothing() -> None:
    calculator, presentation = MetricCalculator(), MetricPresentation(smoothing_alpha=.5)
    presentation.present(calculator.compute(MetricInput({"theta": 8, "alpha": 4, "smr": 4, "beta": 4, "gamma": 1}, None, None, None, "theta-beta-ratio", 1.85, True)))
    snapshot = calculator.compute(MetricInput({"theta": 4, "alpha": 8, "smr": 8, "beta": 8, "gamma": 1}, None, None, None, "theta-beta-ratio", 1.85, True))
    displayed = presentation.present(snapshot)
    assert displayed.smoothed_band_powers["theta"] == 6
    assert displayed.smoothed_band_powers["beta"] == 6
    # The raw theta/beta ratios were 2 then 0.5, so their output-smoothed value is 1.25.
    assert displayed.smoothed_metrics["ratio:thetaBeta"] == 1.25
    # Alpha/theta follows the same output-smoothing rule: 0.5 then 2.
    assert displayed.smoothed_metrics["ratio:alphaTheta"] == 1.25
    assert sum(snapshot.relative_bands.values()) == 1


def test_every_named_ratio_is_available() -> None:
    ratios = compute_band_ratios({"theta": 2, "alpha": 4, "smr": 3, "beta": 8, "gamma": 1})
    assert {"thetaBeta", "betaTheta", "alphaTheta", "thetaAlpha", "smrTheta", "thetaAlphaBeta", "alphaBeta", "betaAlpha", "arousal", "valence"} <= ratios.keys()


def test_theta_beta_ratio_uses_legacy_beta_floor() -> None:
    ratios = compute_band_ratios({"theta": 0.3, "alpha": 1, "smr": 1, "beta": 0.01, "gamma": 1})
    assert math.isclose(ratios["thetaBeta"], 3)


def test_brainflow_scores_are_output_smoothed_and_resettable() -> None:
    smoother = BrainFlowScoreSmoother(.5)
    assert smoother.push(1, 1).mindfulness_score == 100
    assert smoother.push(0, 0).mindfulness_score == 50
    smoother.reset()
    assert smoother.push(.2, .2).mindfulness_score == 20


def test_backend_smoothing_defaults_to_point_zero_five_and_zero_disables_it() -> None:
    smoother = BandPowerSmoother()
    assert smoother.push({"theta": 10})["theta"] == 10
    assert smoother.push({"theta": 0})["theta"] == 9.5
    assert smooth_ema(10, 0, 0) == 0


def test_protocol_feedback_names_the_actual_metric() -> None:
    bands = {"theta": 8, "alpha": 5, "smr": 7, "beta": 4}
    feedback = compute_protocol_feedback(bands, compute_band_ratios(bands), "smr-enhancement", 6)
    assert feedback.metric_name == "smr" and feedback.value == 7 and feedback.in_zone


def test_normalize_and_ema_helpers() -> None:
    assert normalize_brainflow_score(.5) == 50
    assert normalize_brainflow_score(None) is None
    assert smooth_ema(80, 0, .5) == 40


def test_calibration_makes_selected_display_metrics_relative_to_their_own_baselines() -> None:
    calculator, presentation = MetricCalculator(), MetricPresentation()
    baseline = MetricInput({"theta": 4, "alpha": 6, "smr": 3, "beta": 2, "gamma": 1}, .5, .4, .6, "theta-beta-ratio", 1.85, True)
    presentation.start_calibration({"thetaBeta"})
    for _ in range(24):
        displayed = presentation.present(calculator.compute(baseline))
    assert displayed.calibration_status == "active"
    assert displayed.baseline_relative_metrics["ratio:thetaBeta"] == 50
    # A selected calibration changes only that metric; other values remain raw.
    assert calculator.compute(baseline).brainflow_scores.mindfulness_score == 40
    # Protocol feedback remains in absolute units so its training target does
    # not move when the display is calibrated.
    assert calculator.compute(baseline).protocol_feedback.value is not None
    presentation.reset_calibration()
    displayed = presentation.present(calculator.compute(baseline))
    assert displayed.calibration_status == "off"
    assert not displayed.baseline_relative_metrics


def test_calibration_uses_a_normal_distribution_percentile() -> None:
    calculator, presentation = MetricCalculator(), MetricPresentation(smoothing_alpha=1)
    presentation.start_calibration({"thetaBeta"})
    for theta in range(1, 25):
        presentation.present(calculator.compute(MetricInput({"theta": theta, "beta": 1}, None, None, None, "theta-beta-ratio", 1.85, True)))
    snapshot = presentation.present(calculator.compute(MetricInput({"theta": 30, "beta": 1}, None, None, None, "theta-beta-ratio", 1.85, True)))
    # A value well above calibration maps above the distribution midpoint.
    assert 50 < snapshot.baseline_relative_metrics["ratio:thetaBeta"] < 100
