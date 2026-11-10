// 摘自 Folia：本项目的背景由 VisualizerShell 直接绘制，这里只保留“浮名”读写的字段。
export interface VisualizerBackgroundConfig {
    transparent?: boolean;
    common?: {
        disableGeometricBackground?: boolean;
    };
}
