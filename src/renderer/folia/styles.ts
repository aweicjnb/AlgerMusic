// 全屏歌词可选的动画样式。这个文件不引用 React，Vue 页面可以直接用。
export const FOLIA_STYLES = [
    { value: 'fume', label: '浮名', description: '整页排版，镜头穿行' },
    { value: 'classic', label: '流光', description: '单行居中，逐字点亮' },
    { value: 'tilt', label: '倾诉', description: '主行水平，副行倾斜' },
    { value: 'partita', label: '云阶', description: '逐行错落的阶梯' },
    { value: 'claddagh', label: '回环', description: '倾斜的椭圆轨道' },
    { value: 'cadenza', label: '心象', description: '字符散落成云' },
    { value: 'still', label: '静止', description: '三行静态歌词' },
] as const;

export type FoliaStyle = (typeof FOLIA_STYLES)[number]['value'];
