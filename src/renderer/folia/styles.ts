// 全屏歌词可选的动画样式。这个文件不引用 React，Vue 页面可以直接用。
export const FOLIA_STYLES = [
    { value: 'fume', label: '浮名', description: '整页排版，镜头穿行' },
    { value: 'classic', label: '流光', description: '单行居中，逐字点亮' },
    { value: 'tilt', label: '倾诉', description: '主行水平，副行倾斜' },
    { value: 'partita', label: '云阶', description: '逐行错落的阶梯' },
    { value: 'claddagh', label: '回环', description: '倾斜的椭圆轨道' },
    { value: 'cadenza', label: '心象', description: '字符散落成云' },
    { value: 'still', label: '静止', description: '三行静态歌词' },
    { value: 'sonnet', label: '商籁', description: '镂空大字与动态诗稿' },
    { value: 'hanabi', label: '花火', description: '逐字烟花与日系拼贴' },
    { value: 'monet', label: '莫奈', description: '肖像海报与底部频谱' },
    { value: 'pendolo', label: '时计', description: '沿钟表盘逐格推进' },
    { value: 'diorama', label: '镜台', description: '点阵歌词在三维空间穿行' },
    { value: 'nebbia', label: '雾笺', description: '雨夜车窗上的手写歌词' },
    { value: 'cappella', label: '群唱', description: '头像与聊天气泡对唱' },
    { value: 'lumiere', label: '绘光', description: '烟雾里的光束照亮刻字' },
    { value: 'tempera', label: '凝彩', description: '色块重组与反色文字' },
    { value: 'machi', label: '町景', description: '三维街景招牌逐字点亮' },
] as const;

export type FoliaStyle = (typeof FOLIA_STYLES)[number]['value'];
