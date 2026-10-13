"use strict";
figma.showUI(__html__, {
    width: 760,
    height: 700
});
function sendStatus(message) {
    figma.ui.postMessage({
        type: "status",
        message
    });
}
function sendError(message) {
    figma.ui.postMessage({
        type: "error",
        message
    });
}
function classifyViewport(node) {
    const name = node.name.toLowerCase();
    const width = "width" in node && typeof node.width === "number"
        ? node.width
        : undefined;
    if (name.includes("tablet") || name.includes("平板") || width === 800) {
        return "TABLET_800";
    }
    if (name.includes("mobile") || name.includes("手機") || width === 390) {
        return "MOBILE_390";
    }
    if (name.includes("desktop") || name.includes("電腦") || width === 1440) {
        return "DESKTOP_1440";
    }
    return "OTHER";
}
function describeTrigger(trigger) {
    return trigger ? { ...trigger } : null;
}
function describeTransition(transition) {
    return transition ? { ...transition } : null;
}
function describeAction(action, nodeMap) {
    const result = { type: action.type };
    if (action.type === "NODE") {
        result.navigation = action.navigation;
        result.destinationId = action.destinationId;
        result.destinationName = action.destinationId
            ? nodeMap.get(action.destinationId)?.name ?? null
            : null;
        result.destinationPage = action.destinationId
            ? nodeMap.get(action.destinationId)?.parent?.name ?? null
            : null;
        result.transition = describeTransition(action.transition);
        result.resetScrollPosition = action.resetScrollPosition;
        result.resetInteractiveComponents = action.resetInteractiveComponents;
        result.overlayRelativePosition = action.overlayRelativePosition;
    }
    else if (action.type === "URL") {
        result.url = action.url;
        result.openInNewTab = action.openInNewTab;
    }
    else if (action.type === "CONDITIONAL") {
        result.conditionalBlocks = action.conditionalBlocks.map((block) => ({
            condition: block.condition,
            actions: block.actions.map((nestedAction) => describeAction(nestedAction, nodeMap))
        }));
    }
    else if (action.type === "SET_VARIABLE") {
        result.variableId = action.variableId;
        result.variableValue = action.variableValue;
    }
    else if (action.type === "SET_VARIABLE_MODE") {
        result.variableCollectionId = action.variableCollectionId;
        result.variableModeId = action.variableModeId;
    }
    else if (action.type === "UPDATE_MEDIA_RUNTIME") {
        result.destinationId = action.destinationId;
        result.mediaAction = action.mediaAction;
    }
    return result;
}
function serializeReaction(reaction, nodeMap) {
    const actions = reaction.actions ?? (reaction.action ? [reaction.action] : []);
    return {
        trigger: describeTrigger(reaction.trigger),
        actions: actions.map((action) => describeAction(action, nodeMap))
    };
}
function collectSceneNodes(node, pageName, parentId, depth, nodeMap, output) {
    nodeMap.set(node.id, node);
    const reactions = "reactions" in node
        ? (node.reactions ?? [])
        : [];
    const item = {
        id: node.id,
        name: node.name,
        type: node.type,
        page: pageName,
        parentId,
        depth,
        viewport: classifyViewport(node),
        childCount: "children" in node ? node.children.length : 0,
        reactionCount: reactions.length,
        reactions: []
    };
    if ("x" in node) {
        item.x = node.x;
        item.y = node.y;
    }
    if ("width" in node) {
        item.width = node.width;
        item.height = node.height;
    }
    output.push(item);
    if ("children" in node) {
        for (const child of node.children) {
            collectSceneNodes(child, pageName, node.id, depth + 1, nodeMap, output);
        }
    }
}
async function exportDocumentInventory() {
    sendStatus("開始盤點所有 Page、Frame 與 Prototype...");
    await figma.loadAllPagesAsync();
    const pages = figma.root.children;
    const nodeMap = new Map();
    const nodes = [];
    for (const page of pages) {
        nodeMap.set(page.id, page);
        for (const child of page.children) {
            collectSceneNodes(child, page.name, page.id, 0, nodeMap, nodes);
        }
    }
    for (const item of nodes) {
        const source = nodeMap.get(item.id);
        if (source && "reactions" in source) {
            const reactions = source.reactions ?? [];
            item.reactions = reactions.map((reaction) => serializeReaction(reaction, nodeMap));
        }
    }
    const pageReports = pages.map((page) => ({
        id: page.id,
        name: page.name,
        prototypeStartNode: page.prototypeStartNode
            ? {
                id: page.prototypeStartNode.id,
                name: page.prototypeStartNode.name,
                type: page.prototypeStartNode.type
            }
            : null,
        flowStartingPoints: page.flowStartingPoints.map((flow) => ({
            ...flow,
            nodeName: nodeMap.get(flow.nodeId)?.name ?? null
        })),
        rootNodeIds: page.children.map((child) => child.id)
    }));
    const viewportCounts = nodes.reduce((counts, node) => {
        counts[node.viewport] = (counts[node.viewport] ?? 0) + 1;
        return counts;
    }, {});
    const reactionCount = nodes.reduce((total, node) => total + node.reactionCount, 0);
    const report = {
        schemaVersion: "uupon-figma-inventory-1",
        exportedAt: new Date().toISOString(),
        source: "Figma Plugin API",
        summary: {
            pageCount: pages.length,
            nodeCount: nodes.length,
            reactionCount,
            flowCount: pageReports.reduce((total, page) => total + page.flowStartingPoints.length, 0),
            viewportCounts
        },
        pages: pageReports,
        nodes
    };
    figma.ui.postMessage({
        type: "inventory-result",
        json: JSON.stringify(report, null, 2)
    });
    sendStatus(`盤點完成：${pages.length} 個 Page、${nodes.length} 個節點、${reactionCount} 個 Prototype reactions`);
}
// =========================
// 工具函式
// =========================
function cloneSolidPaint(paint) {
    return {
        type: "SOLID",
        color: {
            r: paint.color.r,
            g: paint.color.g,
            b: paint.color.b
        },
        opacity: paint.opacity
    };
}
function exportPaints(paints) {
    if (paints === figma.mixed) {
        return undefined;
    }
    const result = [];
    for (const paint of paints) {
        // Step 1 先只處理 SOLID
        if (paint.type === "SOLID") {
            result.push({
                type: "SOLID",
                color: {
                    r: paint.color.r,
                    g: paint.color.g,
                    b: paint.color.b
                },
                opacity: paint.opacity
            });
        }
    }
    return result;
}
function importPaints(data) {
    if (!Array.isArray(data)) {
        return undefined;
    }
    const paints = [];
    for (const paint of data) {
        if (paint &&
            paint.type === "SOLID" &&
            paint.color &&
            typeof paint.color.r === "number" &&
            typeof paint.color.g === "number" &&
            typeof paint.color.b === "number") {
            const solid = {
                type: "SOLID",
                color: {
                    r: paint.color.r,
                    g: paint.color.g,
                    b: paint.color.b
                }
            };
            if (typeof paint.opacity === "number") {
                solid.opacity = paint.opacity;
            }
            paints.push(solid);
        }
        else if (paint &&
            paint.type === "GRADIENT_LINEAR" &&
            Array.isArray(paint.gradientTransform) &&
            Array.isArray(paint.gradientStops)) {
            paints.push({
                type: "GRADIENT_LINEAR",
                gradientTransform: paint.gradientTransform,
                gradientStops: paint.gradientStops.map((stop) => ({
                    position: stop.position,
                    color: { r: stop.color.r, g: stop.color.g, b: stop.color.b, a: stop.color.a }
                }))
            });
        }
    }
    return paints;
}
function base64ToBytes(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const output = [];
    let buffer = 0;
    let bits = 0;
    for (const character of value.replace(/=+$/, "")) {
        const digit = alphabet.indexOf(character);
        if (digit < 0)
            continue;
        buffer = (buffer << 6) | digit;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output.push((buffer >> bits) & 0xff);
        }
    }
    return new Uint8Array(output);
}
function applyVisualProperties(node, data) {
    if ("fills" in node &&
        data.fills !== undefined) {
        const fills = importPaints(data.fills);
        if (fills) {
            try {
                node.fills = fills;
            }
            catch (error) {
                console.warn("fills 套用失敗:", data.name, error);
            }
        }
    }
    if ("strokes" in node &&
        data.strokes !== undefined) {
        const strokes = importPaints(data.strokes);
        if (strokes) {
            try {
                node.strokes = strokes;
            }
            catch (error) {
                console.warn("strokes 套用失敗:", data.name, error);
            }
        }
    }
    if ("strokeWeight" in node &&
        typeof data.strokeWeight === "number") {
        try {
            node.strokeWeight =
                data.strokeWeight;
        }
        catch (error) {
            console.warn("strokeWeight 套用失敗:", data.name, error);
        }
    }
    if ("opacity" in node &&
        typeof data.opacity === "number") {
        node.opacity = data.opacity;
    }
    if ("cornerRadius" in node &&
        typeof data.cornerRadius === "number") {
        try {
            node.cornerRadius =
                data.cornerRadius;
        }
        catch (error) {
            console.warn("cornerRadius 套用失敗:", data.name, error);
        }
    }
    if ("visible" in node &&
        typeof data.visible === "boolean") {
        node.visible = data.visible;
    }
    // Desktop / Mobile JSON 專用：描邊內側（對應 CSS border）、陰影（box-shadow）。
    if ("strokeAlign" in node && (data.strokeAlign === "INSIDE" || data.strokeAlign === "OUTSIDE" || data.strokeAlign === "CENTER")) {
        try {
            node.strokeAlign = data.strokeAlign;
        }
        catch (error) {
            console.warn("strokeAlign 套用失敗:", data.name, error);
        }
    }
    if ("effects" in node && Array.isArray(data.effects)) {
        const effects = [];
        for (const effect of data.effects) {
            if (!effect || (effect.type !== "DROP_SHADOW" && effect.type !== "INNER_SHADOW"))
                continue;
            effects.push({
                type: effect.type,
                color: { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a },
                offset: { x: effect.offset?.x || 0, y: effect.offset?.y || 0 },
                radius: effect.radius || 0,
                spread: effect.spread || 0,
                visible: true,
                blendMode: "NORMAL"
            });
        }
        try {
            node.effects = effects;
        }
        catch (error) {
            console.warn("effects 套用失敗:", data.name, error);
        }
    }
    // Desktop / Mobile JSON 專用：Auto Layout（手風琴展開時推動下方內容）。
    if ((node.type === "FRAME" || node.type === "COMPONENT") && (data.layoutMode === "VERTICAL" || data.layoutMode === "HORIZONTAL")) {
        try {
            const frame = node;
            frame.layoutMode = data.layoutMode;
            if (typeof data.itemSpacing === "number")
                frame.itemSpacing = data.itemSpacing;
            if (typeof data.paddingLeft === "number")
                frame.paddingLeft = data.paddingLeft;
            if (typeof data.paddingRight === "number")
                frame.paddingRight = data.paddingRight;
            if (typeof data.paddingTop === "number")
                frame.paddingTop = data.paddingTop;
            if (typeof data.paddingBottom === "number")
                frame.paddingBottom = data.paddingBottom;
            if (data.primaryAxisSizingMode === "AUTO" || data.primaryAxisSizingMode === "FIXED")
                frame.primaryAxisSizingMode = data.primaryAxisSizingMode;
            if (data.counterAxisSizingMode === "AUTO" || data.counterAxisSizingMode === "FIXED")
                frame.counterAxisSizingMode = data.counterAxisSizingMode;
        }
        catch (error) {
            console.warn("Auto Layout 套用失敗:", data.name, error);
        }
    }
    // Desktop / Tablet / Mobile JSON 專用：Frame 是否裁切內容（一般 Figma JSON 沒有此欄位，行為不變）。
    if ("clipsContent" in node &&
        typeof data.clipsContent === "boolean") {
        node.clipsContent = data.clipsContent;
    }
}
// =========================
// Export
// Step 1：基本結構 + SOLID fills/strokes
// =========================
function serializeBasic(node) {
    const result = {
        id: node.id,
        name: node.name,
        type: node.type
    };
    if ("x" in node) {
        result.x = node.x;
        result.y = node.y;
    }
    if ("width" in node) {
        result.width = node.width;
        result.height = node.height;
    }
    if ("visible" in node) {
        result.visible = node.visible;
    }
    if ("opacity" in node) {
        result.opacity = node.opacity;
    }
    if ("fills" in node) {
        result.fills = exportPaints(node.fills);
    }
    if ("strokes" in node) {
        result.strokes = exportPaints(node.strokes);
    }
    if ("strokeWeight" in node) {
        try {
            result.strokeWeight =
                node.strokeWeight;
        }
        catch {
            // 忽略 mixed / unsupported
        }
    }
    if ("cornerRadius" in node) {
        try {
            const radius = node.cornerRadius;
            if (typeof radius === "number") {
                result.cornerRadius = radius;
            }
        }
        catch {
            // 忽略
        }
    }
    if (node.type === "TEXT") {
        result.characters = node.characters;
        result.fontSize =
            typeof node.fontSize === "number"
                ? node.fontSize
                : undefined;
        result.fontName =
            node.fontName !== figma.mixed
                ? node.fontName
                : undefined;
    }
    if ("children" in node) {
        result.children = node.children.map((child) => serializeBasic(child));
    }
    return result;
}
async function exportSelection() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        sendError("請先選擇一個 Frame / Component");
        return;
    }
    sendStatus("開始匯出目前選取內容...");
    const data = selection.map((node) => serializeBasic(node));
    figma.ui.postMessage({
        type: "export-result",
        json: JSON.stringify(data, null, 2)
    });
    sendStatus("匯出完成，共 " +
        selection.length +
        " 個根節點");
}
// =========================
// Import
// Step 1：FRAME / RECTANGLE / TEXT
// + Fill / Stroke / Opacity / Corner Radius
// =========================
async function loadTextFont(data) {
    if (data.fontName &&
        typeof data.fontName.family === "string" &&
        typeof data.fontName.style === "string") {
        const preferred = {
            family: data.fontName.family,
            style: data.fontName.style
        };
        try {
            await figma.loadFontAsync(preferred);
            return preferred;
        }
        catch (error) {
            console.warn("原字型載入失敗，改用 Inter:", preferred, error);
        }
    }
    const fallback = {
        family: "Inter",
        style: "Regular"
    };
    await figma.loadFontAsync(fallback);
    return fallback;
}
// 段落內混合樣式（連結、粗體、不同顏色）：在整體填色之後逐段套用，避免被覆蓋。
async function applyTextRanges(text, data) {
    if (!Array.isArray(data.styledRanges))
        return;
    for (const range of data.styledRanges) {
        const start = Math.max(0, Math.min(range.start, text.characters.length));
        const end = Math.max(start, Math.min(range.end, text.characters.length));
        if (end <= start)
            continue;
        try {
            if (range.fontName && range.fontName.family) {
                const rangeFont = await loadTextFont({ fontName: range.fontName });
                text.setRangeFontName(start, end, rangeFont);
            }
            if (typeof range.fontSize === "number")
                text.setRangeFontSize(start, end, range.fontSize);
            if (Array.isArray(range.fills)) {
                const fills = importPaints(range.fills);
                if (fills)
                    text.setRangeFills(start, end, fills);
            }
            if (range.textDecoration === "UNDERLINE" || range.textDecoration === "NONE") {
                text.setRangeTextDecoration(start, end, range.textDecoration);
            }
        }
        catch (error) {
            console.warn("文字範圍樣式套用失敗:", data.name, error);
        }
    }
}
async function createNodeFromJson(data, parent) {
    if (data.type === "COMPONENT_SET") {
        const host = parent || figma.currentPage;
        const variants = [];
        const baseX = typeof data.x === "number" ? data.x : 0;
        const baseY = typeof data.y === "number" ? data.y : 0;
        if (Array.isArray(data.children)) {
            for (const child of data.children) {
                const childData = {
                    ...child,
                    x: baseX + (typeof child.x === "number" ? child.x : 0),
                    y: baseY + (typeof child.y === "number" ? child.y : 0)
                };
                const created = await createNodeFromJson(childData, host);
                if (created && created.type === "COMPONENT") {
                    variants.push(created);
                }
            }
        }
        if (variants.length === 0) {
            console.warn("COMPONENT_SET 沒有可用的 COMPONENT Variant:", data.name);
            return null;
        }
        const componentSet = figma.combineAsVariants(variants, host);
        componentSet.name = data.name || "Component Set";
        return componentSet;
    }
    let node = null;
    if (data.type === "FRAME") {
        const frame = figma.createFrame();
        frame.name =
            data.name || "Frame";
        if (typeof data.width === "number" &&
            typeof data.height === "number") {
            frame.resize(Math.max(data.width, 1), Math.max(data.height, 1));
        }
        node = frame;
    }
    else if (data.type === "COMPONENT") {
        const component = figma.createComponent();
        component.name =
            data.name || "Component";
        if (typeof data.width === "number" &&
            typeof data.height === "number") {
            component.resize(Math.max(data.width, 1), Math.max(data.height, 1));
        }
        node = component;
    }
    else if (data.type === "RECTANGLE") {
        const rect = figma.createRectangle();
        // Figma 的 Rectangle 預設會有灰色填色；JSON 沒有 fills
        // 代表透明，而不是使用 Figma 預設灰色。
        rect.fills = [];
        rect.name =
            data.name || "Rectangle";
        if (typeof data.width === "number" &&
            typeof data.height === "number") {
            rect.resize(Math.max(data.width, 1), Math.max(data.height, 1));
        }
        node = rect;
    }
    else if (data.type === "TEXT") {
        const text = figma.createText();
        // Desktop / Mobile JSON：fontWeight ≥ 600 使用 Bold（沒有指定 fontName 時才生效）。
        if (!data.fontName && (data.italic === true || (typeof data.fontWeight === "number" && data.fontWeight >= 600))) {
            const bold = typeof data.fontWeight === "number" && data.fontWeight >= 600;
            const style = bold ? (data.italic === true ? "Bold Italic" : "Bold") : "Italic";
            data = { ...data, fontName: { family: "Inter", style } };
        }
        const font = await loadTextFont(data);
        text.fontName = font;
        text.name =
            data.name || "Text";
        text.characters =
            data.characters ||
                data.name ||
                "";
        if (typeof data.fontSize === "number") {
            text.fontSize =
                data.fontSize;
        }
        if (typeof data.lineHeightPx === "number" &&
            data.lineHeightPx > 0) {
            text.lineHeight = {
                unit: "PIXELS",
                value: data.lineHeightPx
            };
        }
        if (data.textAlignHorizontal === "CENTER" || data.textAlignHorizontal === "RIGHT") {
            text.textAlignHorizontal = data.textAlignHorizontal;
        }
        if (data.textDecoration === "UNDERLINE") {
            text.textDecoration = "UNDERLINE";
        }
        // React 的 line-clamp / 單行省略：保留全文，只顯示指定行數並以「…」結尾
        if (typeof data.maxLines === "number" && data.maxLines > 0) {
            try {
                text.textTruncation = "ENDING";
                text.maxLines = data.maxLines;
            }
            catch (error) {
                console.warn("maxLines 套用失敗:", data.name, error);
            }
        }
        if (typeof data.letterSpacing === "number" && data.letterSpacing !== 0) {
            text.letterSpacing = { unit: "PIXELS", value: data.letterSpacing };
        }
        if (data.textAutoResize === "WIDTH_AND_HEIGHT") {
            // 單行文字：不讓字型差異造成斷行
            text.textAutoResize = "WIDTH_AND_HEIGHT";
        }
        else if (typeof data.width === "number") {
            text.textAutoResize = "HEIGHT";
            text.resize(Math.max(data.width, 1), Math.max(typeof data.height === "number"
                ? data.height
                : text.height, 1));
        }
        node = text;
    }
    else if (data.type === "IMAGE") {
        if (typeof data.imageData !== "string" || data.imageData.length === 0) {
            console.warn("IMAGE 缺少 imageData:", data.name);
            return null;
        }
        const rect = figma.createRectangle();
        rect.name = data.name || "Image";
        if (typeof data.width === "number" &&
            typeof data.height === "number") {
            rect.resize(Math.max(data.width, 1), Math.max(data.height, 1));
        }
        const image = figma.createImage(base64ToBytes(data.imageData));
        rect.fills = [{
                type: "IMAGE",
                imageHash: image.hash,
                scaleMode: "FILL"
            }];
        node = rect;
    }
    else if (data.type === "SVG") {
        // Desktop / Mobile JSON：向量圖示（保留 SVG 路徑，不用點陣圖）。
        try {
            const svgFrame = figma.createNodeFromSvg(String(data.svg || ""));
            svgFrame.name = data.name || "Icon";
            if (typeof data.width === "number" && svgFrame.width > 0 && Math.abs(svgFrame.width - data.width) > 0.01) {
                svgFrame.rescale(Math.max(data.width, 1) / svgFrame.width);
            }
            node = svgFrame;
        }
        catch (error) {
            console.warn("SVG 建立失敗:", data.name, error);
            return null;
        }
    }
    else if (data.type === "INSTANCE") {
        node = createInstanceFromJson(data);
        if (!node)
            return null;
    }
    else {
        console.warn("Step 1 尚未支援節點類型:", data.type, data.name);
        return null;
    }
    // 先 append，再設定 x/y
    // 這樣 x/y 會以 parent 為座標系
    if (parent) {
        parent.appendChild(node);
    }
    // Auto Layout 內的絕對定位子層（例如 Chat 啟動鈕）
    if (data.layoutPositioning === "ABSOLUTE" && "layoutPositioning" in node) {
        try {
            node.layoutPositioning = "ABSOLUTE";
        }
        catch (error) {
            console.warn("layoutPositioning 套用失敗:", data.name, error);
        }
    }
    const inAutoLayout = !!parent &&
        "layoutMode" in parent &&
        parent.layoutMode !== "NONE" &&
        node.layoutPositioning !== "ABSOLUTE";
    if (typeof data.x === "number" &&
        !inAutoLayout) {
        node.x = data.x;
    }
    if (typeof data.y === "number" &&
        !inAutoLayout) {
        node.y = data.y;
    }
    applyVisualProperties(node, data);
    if (node.type === "TEXT")
        await applyTextRanges(node, data);
    if (data.pluginData && typeof data.pluginData === "object") {
        for (const [key, value] of Object.entries(data.pluginData)) {
            if (value !== undefined && value !== null && value !== "")
                node.setPluginData(key, String(value));
        }
    }
    if ("children" in node &&
        Array.isArray(data.children) &&
        node.type !== "INSTANCE") {
        for (const child of data.children) {
            await createNodeFromJson(child, node);
        }
    }
    return node;
}
async function importJson(jsonText, replaceExisting = false) {
    sendStatus("Plugin 已收到 import-json，開始解析 JSON...");
    let data;
    try {
        data =
            JSON.parse(jsonText);
    }
    catch (error) {
        sendError("JSON 格式錯誤：" +
            String(error));
        return;
    }
    const items = [];
    const appendItems = (value) => {
        if (Array.isArray(value)) {
            for (const child of value)
                appendItems(child);
        }
        else {
            items.push(value);
        }
    };
    appendItems(data);
    const created = [];
    const replaced = [];
    let skipped = 0;
    for (const item of items) {
        try {
            const acceptedNames = typeof item?.name === "string" ? [item.name] : [];
            const replaceableTypes = new Set(["FRAME", "COMPONENT", "COMPONENT_SET"]);
            const existing = replaceExisting && replaceableTypes.has(item?.type) && typeof item?.name === "string"
                ? figma.currentPage.children.filter((candidate) => candidate.type === item.type && acceptedNames.includes(candidate.name))
                : [];
            const node = await createNodeFromJson(item);
            if (node) {
                if (existing.length > 0) {
                    node.x = existing[0].x;
                    node.y = existing[0].y;
                    replaced.push(...existing);
                }
                else {
                    node.x += 1600;
                }
                created.push(node);
            }
            else {
                skipped++;
            }
        }
        catch (error) {
            for (const node of created) {
                if (!node.removed)
                    node.remove();
            }
            sendError("建立節點失敗：" +
                (item?.name ||
                    "unknown") +
                "\n" +
                String(error));
            return;
        }
    }
    if (created.length === 0) {
        sendError("JSON 有收到，但沒有建立任何支援的節點。");
        return;
    }
    for (const node of replaced) {
        if (!node.removed && !created.includes(node))
            node.remove();
    }
    figma.currentPage.selection =
        created;
    figma.viewport
        .scrollAndZoomIntoView(created);
    sendStatus("完成：已建立 " +
        created.length +
        " 個根節點" +
        (replaceExisting ? "，已替換 " + replaced.length + " 個同名根節點" : "") +
        (skipped > 0
            ? "，略過 " +
                skipped +
                " 個不支援節點"
            : ""));
    figma.notify("Step 1 匯入完成");
}
// =========================
// Desktop 1440 / Tablet 800 / Mobile 390 匯入（schema v8）
// 只處理名稱以「/ Desktop」「/ Tablet」「/ Mobile」結尾的畫面，
// 以及 Header / Footer / Banner / Chat / FAQ / Survey Prompt 的 Desktop、Tablet、Mobile 元件。
// =========================
const v2Warnings = [];
function topLevelByName(name, types) {
    return figma.currentPage.children.find((node) => types.includes(node.type) && node.name === name);
}
function findMainComponent(componentName, variantName) {
    const set = topLevelByName(componentName, ["COMPONENT_SET"]);
    if (set) {
        if (!variantName)
            return set.defaultVariant || null;
        return set.children.find((child) => child.type === "COMPONENT" && child.name === variantName) || null;
    }
    const single = topLevelByName(componentName, ["COMPONENT"]);
    return single || null;
}
function createInstanceFromJson(data) {
    const main = findMainComponent(String(data.component || ""), data.variant);
    if (!main) {
        v2Warnings.push(`找不到主元件：${data.component} / ${data.variant || "-"}`);
        const placeholder = figma.createFrame();
        placeholder.name = `[MISSING COMPONENT] ${data.component}`;
        placeholder.resize(Math.max(data.width || 10, 1), Math.max(data.height || 10, 1));
        placeholder.fills = [{ type: "SOLID", color: { r: 1, g: 0.8, b: 0.8 } }];
        return placeholder;
    }
    const instance = main.createInstance();
    instance.name = data.name || main.name;
    return instance;
}
// 固定圖層對應 React 的 position: fixed：Chat 啟動鈕（所有尺寸）與 Header（Tablet／Mobile 的 nav 固定在頂端）。
// Figma 的固定圖層必須是 Frame 最上層的最後幾個子層，所以依「Header、Chat」順序移到最後再設定數量。
function fixPinnedInstances(frame) {
    const compact = / \/ (Tablet|Mobile)$/.test(frame.name);
    const pinned = [];
    if (compact) {
        const header = frame.children.find((child) => child.type === "INSTANCE" && child.name === "Header");
        if (header)
            pinned.push(header);
    }
    const chat = frame.children.find((child) => child.type === "INSTANCE" && child.name === "Chat");
    if (chat)
        pinned.push(chat);
    if (pinned.length === 0)
        return 0;
    for (const node of pinned)
        frame.appendChild(node);
    try {
        frame.numberOfFixedChildren = pinned.length;
        return pinned.length;
    }
    catch (error) {
        console.warn("設定固定位置失敗:", frame.name, error);
        return 0;
    }
}
function fixAllPinnedOnPage() {
    let pinned = 0;
    let frames = 0;
    let fixedFrames = 0;
    for (const node of figma.currentPage.children) {
        if (node.type !== "FRAME" || !/ \/ (Desktop|Tablet|Mobile)$/.test(node.name))
            continue;
        frames++;
        const count = fixPinnedInstances(node);
        pinned += count;
        if (count > 0)
            fixedFrames++;
    }
    return { pinned, frames, fixedFrames };
}
async function importDesktopMobileJson(jsonText, kind) {
    v2Warnings.length = 0;
    let data;
    try {
        data = JSON.parse(jsonText);
    }
    catch (error) {
        sendError("JSON 格式錯誤：" + String(error));
        return;
    }
    const items = Array.isArray(data) ? data : [data];
    const page = figma.currentPage;
    let componentRight = 0;
    for (const node of page.children) {
        if (node.type === "COMPONENT_SET" || node.type === "COMPONENT" || node.getPluginData("fxOverlay")) {
            componentRight = Math.max(componentRight, node.x + node.width);
        }
    }
    const created = [];
    const replaced = [];
    const replacedNames = new Set();
    const maxWidth = Math.max(...items.map((item) => (typeof item.width === "number" ? item.width : 0)), 1);
    const columns = kind === "screens" ? (maxWidth > 1000 ? 4 : 8) : 1;
    const gap = kind === "screens" ? 200 : 160;
    const startX = kind === "screens" ? (componentRight > 0 ? componentRight + 400 : 0) : 0;
    let cursorY = 0;
    let rowHeight = 0;
    let col = 0;
    for (const item of items) {
        try {
            const existing = page.children.find((candidate) => candidate.type === item.type && candidate.name === item.name);
            const node = await createNodeFromJson({ ...item, x: 0, y: 0 });
            if (!node) {
                v2Warnings.push(`未建立：${item.name}`);
                continue;
            }
            if (existing) {
                node.x = existing.x;
                node.y = existing.y;
                replaced.push(existing);
                replacedNames.add(existing.name);
            }
            else if (kind === "components") {
                // 先建立，稍後統一排版（主要元件一欄、Hover 元件在右側排成網格）
                node.x = 0;
                node.y = 0;
            }
            else {
                if (col >= columns) {
                    col = 0;
                    cursorY += rowHeight + gap;
                    rowHeight = 0;
                }
                node.x = startX + col * (maxWidth + gap);
                node.y = cursorY;
                rowHeight = Math.max(rowHeight, node.height);
                col++;
            }
            if (kind === "screens" && node.type === "FRAME")
                fixPinnedInstances(node);
            created.push(node);
        }
        catch (error) {
            for (const node of created)
                if (!node.removed)
                    node.remove();
            sendError("建立節點失敗：" + (item?.name || "unknown") + "\n" + String(error));
            return;
        }
    }
    for (const node of replaced)
        if (!node.removed && !created.includes(node))
            node.remove();
    if (created.length === 0) {
        sendError("沒有建立任何節點。");
        return;
    }
    if (kind === "components") {
        const fresh = created.filter((node) => !items.some((item) => item.name === node.name && replacedNames.has(node.name)));
        const main = fresh.filter((node) => !node.name.startsWith("Hover /"));
        const hover = fresh.filter((node) => node.name.startsWith("Hover /"));
        let y = 0;
        let mainWidth = 0;
        for (const node of main) {
            node.x = 0;
            node.y = y;
            y += node.height + gap;
            mainWidth = Math.max(mainWidth, node.width);
        }
        const gridX = mainWidth + 400;
        let x = gridX;
        let rowY = 0;
        let rowHeight = 0;
        for (const node of hover) {
            if (x > gridX && x + node.width > gridX + 4000) {
                x = gridX;
                rowY += rowHeight + 80;
                rowHeight = 0;
            }
            node.x = x;
            node.y = rowY;
            x += node.width + 80;
            rowHeight = Math.max(rowHeight, node.height);
        }
    }
    figma.viewport.scrollAndZoomIntoView(created.slice(0, 6));
    const warn = v2Warnings.length ? `；警告 ${v2Warnings.length} 筆（${v2Warnings.slice(0, 3).join("、")}）` : "";
    sendStatus(`${kind === "components" ? "共用元件" : "畫面"}匯入完成：建立 ${created.length} 個根節點，替換同名 ${replaced.length} 個${warn}`);
    figma.notify(`${kind === "components" ? "共用元件" : "畫面"}匯入完成：${created.length} 個`);
}
// ---- Prototype v8 ----
function v2Transition(spec) {
    if (!spec || spec.type === "INSTANT")
        return null;
    const easingType = spec.easing === "EASE_IN" || spec.easing === "EASE_IN_AND_OUT" || spec.easing === "LINEAR" ? spec.easing : "EASE_OUT";
    const duration = typeof spec.duration === "number" ? spec.duration : 0.3;
    if (spec.type === "DISSOLVE")
        return { type: "DISSOLVE", easing: { type: easingType }, duration };
    if (spec.type === "SMART_ANIMATE")
        return { type: "SMART_ANIMATE", easing: { type: easingType }, duration };
    return null;
}
function findByFxId(root, fxId) {
    if (root.getPluginData("fxId") === fxId)
        return root;
    if ("children" in root && root.type !== "INSTANCE") {
        for (const child of root.children) {
            const hit = findByFxId(child, fxId);
            if (hit)
                return hit;
        }
    }
    return null;
}
function collectNoInstance(root, out) {
    out.push(root);
    if ("children" in root && root.type !== "INSTANCE") {
        for (const child of root.children)
            collectNoInstance(child, out);
    }
}
function v2PrototypeScopeRoots(spec) {
    const roots = [];
    const suffix = ` / ${sizeLabel(spec.size)}`;
    for (const node of figma.currentPage.children) {
        if (node.type === "FRAME" && node.name.endsWith(suffix))
            roots.push(node);
    }
    const names = [spec.header, spec.footer, spec.banner, spec.chat, ...Object.keys(spec.accordions || {}), ...(spec.hoverSets || [])];
    for (const name of names) {
        const hit = figma.currentPage.children.find((node) => node.name === name && (node.type === "COMPONENT_SET" || node.type === "COMPONENT"));
        if (hit)
            roots.push(hit);
    }
    return roots;
}
async function importPrototypeV2(jsonText) {
    let spec;
    try {
        spec = JSON.parse(jsonText);
    }
    catch (error) {
        sendError("Prototype JSON 格式錯誤：" + String(error));
        return;
    }
    const reactions = Array.isArray(spec.reactions) ? spec.reactions : [];
    if (reactions.length === 0) {
        sendError("Prototype v8 沒有 reactions。");
        return;
    }
    // 1. 清掉範圍內所有舊 Reaction（冪等；也確保文字、圖片、圖示沒有任何 Reaction）
    let cleared = 0;
    for (const root of v2PrototypeScopeRoots(spec)) {
        const all = [];
        collectNoInstance(root, all);
        for (const node of all) {
            if ("reactions" in node && "setReactionsAsync" in node && node.reactions.length > 0) {
                await node.setReactionsAsync([]);
                cleared++;
            }
        }
    }
    // 2. 逐條解析
    const perNode = new Map();
    const failures = [];
    const rootFor = (source) => {
        if (source.scope === "screen") {
            return topLevelByName(source.frame, ["FRAME"]) || null;
        }
        const set = topLevelByName(source.component, ["COMPONENT_SET"]);
        if (set)
            return set.children.find((child) => child.name === source.variant) || null;
        return topLevelByName(source.component, ["COMPONENT"]) || null;
    };
    for (const r of reactions) {
        const root = rootFor(r.source);
        const sourceNode = root ? (r.source.fxId ? findByFxId(root, r.source.fxId) : root) : null;
        if (!sourceNode || !("setReactionsAsync" in sourceNode)) {
            failures.push(`${r.id} 找不到來源 ${JSON.stringify(r.source)}`);
            continue;
        }
        const action = r.action;
        let nodeAction;
        if (action.type === "CLOSE") {
            nodeAction = { type: "CLOSE" };
        }
        else {
            let dest = null;
            if (action.type === "CHANGE_TO")
                dest = findMainComponent(action.component, action.variant);
            else
                dest = topLevelByName(action.destination, ["FRAME"]) || null;
            if (!dest) {
                failures.push(`${r.id} 找不到目的地 ${action.destination || action.component + "/" + action.variant}`);
                continue;
            }
            if (action.type === "NAVIGATE") {
                nodeAction = { type: "NODE", destinationId: dest.id, navigation: "NAVIGATE", transition: null, resetScrollPosition: r.resetScrollPosition !== false, resetInteractiveComponents: r.resetInteractiveComponents !== false };
            }
            else if (action.type === "CHANGE_TO") {
                nodeAction = { type: "NODE", destinationId: dest.id, navigation: "CHANGE_TO", transition: null };
            }
            else {
                nodeAction = { type: "NODE", destinationId: dest.id, navigation: "OVERLAY", transition: null };
            }
        }
        let trigger;
        if (r.trigger === "AFTER_TIMEOUT")
            trigger = { type: "AFTER_TIMEOUT", timeout: r.timeout ?? 0.1 };
        else if (r.trigger === "MOUSE_ENTER" || r.trigger === "MOUSE_LEAVE")
            trigger = { type: r.trigger, delay: 0 };
        else
            trigger = { type: r.trigger === "ON_HOVER" ? "ON_HOVER" : "ON_CLICK" };
        const transition = v2Transition(r.transition);
        if (nodeAction.type === "NODE")
            nodeAction = { ...nodeAction, transition };
        const entry = perNode.get(sourceNode.id) || { node: sourceNode, list: [] };
        entry.list.push({ trigger, actions: [nodeAction] });
        perNode.set(sourceNode.id, entry);
    }
    let applied = 0;
    for (const { node, list } of perNode.values()) {
        try {
            await node.setReactionsAsync(list);
            applied += list.length;
        }
        catch (error) {
            failures.push(`${node.name} 套用失敗：${String(error)}`);
        }
    }
    // 3. 問卷提示 Overlay：overlayPositionType 等屬性在 Plugin API 為唯讀，
    //    因此 Overlay Frame 與所屬畫面同尺寸（預設置中即對齊左上角），不依賴手動定位。
    const message = `Prototype v8 匯入完成：套用 ${applied} 條 / ${perNode.size} 個節點，清除舊 Reaction ${cleared} 個，失敗 ${failures.length} 條`;
    sendStatus(message + (failures.length ? "；前幾筆：" + failures.slice(0, 3).join(" | ") : ""));
    figma.notify(message);
}
const SIZE_INFO = {
    desktop: { label: "Desktop", width: 1440 },
    tablet: { label: "Tablet", width: 800 },
    mobile: { label: "Mobile", width: 390 }
};
function sizeLabel(size) {
    return SIZE_INFO[size]?.label || "Desktop";
}
async function validateDesktopMobile(sizeKey) {
    const label = SIZE_INFO[sizeKey].label;
    const width = SIZE_INFO[sizeKey].width;
    const suffix = ` / ${label}`;
    const frames = figma.currentPage.children.filter((n) => n.type === "FRAME" && n.name.endsWith(suffix) && !n.getPluginData("fxOverlay"));
    const names = frames.map((f) => f.name);
    const report = {
        page: figma.currentPage.name,
        size: sizeKey,
        frameCount: frames.length,
        duplicateFrameNames: names.filter((n, i) => names.indexOf(n) !== i),
        wrongWidthFrames: frames.filter((f) => Math.abs(f.width - width) > 0.5).map((f) => f.name),
        heightMismatch: frames.filter((f) => f.getPluginData("fxScrollHeight") && Math.abs(f.height - Number(f.getPluginData("fxScrollHeight"))) > 1).map((f) => f.name),
        textReactions: 0, rectangleReactions: 0, imageOrIconReactions: 0, prototypeHotspots: 0,
        buttonFrameReactions: 0, buttonFramesWithReactions: 0, childOfButtonReactions: 0,
        duplicateReactions: 0, crossPageNavigate: 0, missingDestinations: 0,
        instances: { header: 0, footer: 0, banner: 0, chat: 0, accordion: 0, missingComponent: 0 },
        framesWithoutHeader: [],
        componentSets: {},
    };
    for (const node of figma.currentPage.children) {
        if (node.type === "COMPONENT_SET")
            report.componentSets[node.name] = node.children.length;
    }
    const scope = [...frames];
    for (const node of figma.currentPage.children) {
        if (node.type === "COMPONENT_SET" || node.type === "COMPONENT" || (node.type === "FRAME" && node.getPluginData("fxOverlay")))
            scope.push(node);
    }
    for (const root of scope) {
        const all = [];
        collectNoInstance(root, all);
        for (const node of all) {
            if (node.name.includes("[PROTOTYPE]") || node.name.startsWith("[CONTROL]"))
                report.prototypeHotspots++;
            if (node.type === "INSTANCE") {
                const main = await node.getMainComponentAsync();
                const setName = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.name : main ? main.name : "";
                if (setName.startsWith("Header /"))
                    report.instances.header++;
                else if (setName.startsWith("Footer /"))
                    report.instances.footer++;
                else if (setName.startsWith("Banner /"))
                    report.instances.banner++;
                else if (setName.startsWith("Chat /"))
                    report.instances.chat++;
                else if (setName.includes("Accordion"))
                    report.instances.accordion++;
            }
            if (node.name.startsWith("[MISSING COMPONENT]"))
                report.instances.missingComponent++;
            if (!("reactions" in node))
                continue;
            const reactions = node.reactions;
            if (reactions.length === 0)
                continue;
            const isButtonFrame = (node.type === "FRAME" || node.type === "INSTANCE" || node.type === "COMPONENT") && node.getPluginData("fxId") !== "";
            // 按鈕內的文字／圖片／圖示誤帶 Reaction（巢狀按鈕本身是 Button Frame，不列入）
            if (!isButtonFrame && node.parent && "getPluginData" in node.parent && node.parent.getPluginData("fxId") !== "")
                report.childOfButtonReactions++;
            if (node.type === "TEXT")
                report.textReactions++;
            else if (node.type === "RECTANGLE") {
                const fills = node.fills === figma.mixed ? [] : node.fills;
                if (fills.some((p) => p.type === "IMAGE"))
                    report.imageOrIconReactions++;
                else
                    report.rectangleReactions++;
            }
            else if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION")
                report.imageOrIconReactions++;
            if (isButtonFrame) {
                report.buttonFramesWithReactions++;
                report.buttonFrameReactions += reactions.length;
            }
            const seen = new Set();
            for (const reaction of reactions) {
                const action = reaction.actions ? reaction.actions[0] : reaction.action;
                const key = JSON.stringify([reaction.trigger, action && action.destinationId, action && action.navigation]);
                if (seen.has(key))
                    report.duplicateReactions++;
                seen.add(key);
                if (action && action.type === "NODE" && action.destinationId) {
                    const dest = await figma.getNodeByIdAsync(action.destinationId);
                    if (!dest)
                        report.missingDestinations++;
                    else {
                        let p = dest;
                        while (p && p.type !== "PAGE")
                            p = p.parent;
                        if (!p || p.id !== figma.currentPage.id)
                            report.crossPageNavigate++;
                    }
                }
            }
        }
    }
    for (const frame of frames) {
        const hasHeader = frame.children.some((c) => (c.type === "INSTANCE" && c.name === "Header") || c.name === "Header (inline)");
        if (!hasHeader)
            report.framesWithoutHeader.push(frame.name);
    }
    report.generatedAt = new Date().toISOString();
    figma.ui.postMessage({ type: "v2-report", json: JSON.stringify(report, null, 2) });
    sendStatus(`驗證完成：${frames.length} 個 ${label} Frame，Text Reaction ${report.textReactions}，Hotspot ${report.prototypeHotspots}，跨頁 NAVIGATE ${report.crossPageNavigate}`);
}
// =========================
// UI Message
// =========================
figma.ui.onmessage =
    async (msg) => {
        try {
            if (!msg ||
                !msg.type) {
                sendError("收到無效的 UI Message");
                return;
            }
            if (msg.type ===
                "export-selection") {
                sendStatus("收到 export-selection");
                await exportSelection();
                return;
            }
            if (msg.type === "export-inventory") {
                await exportDocumentInventory();
                return;
            }
            if (msg.type ===
                "import-json") {
                sendStatus("收到 import-json");
                await importJson(msg.json);
                return;
            }
            if (msg.type === "replace-json") {
                sendStatus("收到 replace-json，開始替換同名根節點...");
                await importJson(msg.json, true);
                return;
            }
            if (msg.type === "import-v2-components") {
                await importDesktopMobileJson(msg.json, "components");
                return;
            }
            if (msg.type === "import-v2-screens") {
                await importDesktopMobileJson(msg.json, "screens");
                return;
            }
            if (msg.type === "fix-chat") {
                const result = fixAllPinnedOnPage();
                sendStatus(`固定位置已設定：${result.fixedFrames} / ${result.frames} 個畫面（共 ${result.pinned} 個固定圖層：Chat，Tablet／Mobile 另含 Header）`);
                figma.notify(`固定位置：${result.fixedFrames} / ${result.frames} 個畫面`);
                return;
            }
            if (msg.type === "validate-v2") {
                let size = msg.size === "mobile" || msg.size === "tablet" ? msg.size : "desktop";
                if (msg.size === "auto") {
                    // 依目前 Page 內名稱以「/ Desktop」「/ Tablet」「/ Mobile」結尾的畫面數量判斷尺寸
                    const counts = Object.keys(SIZE_INFO).map((key) => ({
                        key,
                        count: figma.currentPage.children.filter((n) => n.type === "FRAME" && n.name.endsWith(` / ${SIZE_INFO[key].label}`)).length
                    }));
                    counts.sort((x, y) => y.count - x.count);
                    if (counts[0].count === 0) {
                        sendError("目前 Page 找不到名稱以「/ Desktop」「/ Tablet」或「/ Mobile」結尾的畫面，請先到對應的 Page 再驗證。");
                        return;
                    }
                    size = counts[0].key;
                }
                await validateDesktopMobile(size);
                return;
            }
            if (msg.type === "import-prototype") {
                sendStatus("收到 import-prototype");
                if (typeof msg.json === "string" && msg.json.includes('"uupon-prototype-8"')) {
                    await importPrototypeV2(msg.json);
                }
                else {
                    sendError("不支援舊版 Prototype 格式（Tablet v2–v7）。請使用 prototype/*-v8.json 或 *-v1.json（schema uupon-prototype-8）。");
                }
                return;
            }
            if (msg.type === "close") {
                figma.closePlugin();
                return;
            }
            sendError("未知訊息類型：" +
                msg.type);
        }
        catch (error) {
            sendError("Plugin 執行錯誤：" +
                String(error));
        }
    };
