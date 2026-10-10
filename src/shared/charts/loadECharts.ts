type EChartsCoreModule = typeof import("echarts/core");

let echartsModulePromise: Promise<EChartsCoreModule> | null = null;

export function loadECharts(): Promise<EChartsCoreModule> {
  if (!echartsModulePromise) {
    echartsModulePromise = Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ])
      .then(([echarts, charts, components, renderers]) => {
        echarts.use([
          charts.LineChart,
          components.AxisPointerComponent,
          components.DataZoomComponent,
          components.GridComponent,
          components.LegendComponent,
          components.MarkLineComponent,
          components.TooltipComponent,
          renderers.CanvasRenderer,
        ]);
        return echarts;
      })
      .catch((error: unknown) => {
        echartsModulePromise = null;
        throw error;
      });
  }

  return echartsModulePromise;
}
