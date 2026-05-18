/**
 * Plotly component using the CSP-compliant strict bundle.
 * Use this instead of react-plotly.js default to avoid 'unsafe-eval' CSP violations.
 */
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-strict-dist-min';

export default createPlotlyComponent(Plotly);
