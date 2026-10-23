// =========================================================================
// HỆ THỐNG ĐỒNG BỘ GOOGLE SHEET & BÁO ĐƠN TỰ ĐỘNG VỀ GMAIL + ZALO - BA CÔ
// Google Sheet ID: 1ZvX_-wHeoc6fcv43hW_Jj-blOagtsFJiazorJJ8pBBw
// Email nhận thông báo: tranngocmih3011@gmail.com
// =========================================================================

const SPREADSHEET_ID = "1ZvX_-wHeoc6fcv43hW_Jj-blOagtsFJiazorJJ8pBBw";
const ADMIN_EMAIL = "tranngocmih3011@gmail.com";

// =========================================================================
// BƯỚC QUAN TRỌNG: BẤM CHỌN HÀM NÀY VÀ BẤM NÚT "CHẠY (RUN)" ĐỂ CẤP QUYỀN GỬI EMAIL
// Khi bấm "Chạy", Google sẽ hiện bảng yêu cầu cấp quyền -> Bấm "Xem lại quyền"
// -> Chọn tài khoản Google của bạn -> Bấm "Nâng cao (Advanced)" -> Bấm "Đi tới... (không an toàn)" -> Bấm "Cho phép".
// =========================================================================
function testGuiEmailVaCapQuyen() {
  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: "✅ KIỂM TRA KẾT NỐI EMAIL THÀNH CÔNG - NƯỚC MẮM BA CÔ",
    htmlBody: "<h2 style='color:#15803d;'>Chúc mừng bạn! Kết nối email thành công.</h2><p>Hệ thống thông báo đơn hàng của Nước Mắm Ba Cô đã được cấp quyền gửi email tự động tới <b>" + ADMIN_EMAIL + "</b>.</p>"
  });
  Logger.log("Đã gửi email thử nghiệm thành công tới: " + ADMIN_EMAIL);
}

function layBangTinh() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch(e) {}
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch(e) {
    return null;
  }
}

// Hàm chạy 1 lần nếu bạn muốn bấm nút "Chạy (Run)" trực tiếp trong Apps Script để tạo sẵn 3 bảng mới
function khoiTaoBangSanPhamVaNoiDung() {
  var ss = layBangTinh();
  if (!ss) return;
  if (!ss.getSheetByName("SanPham")) {
    var sProd = ss.insertSheet("SanPham");
    khoiTaoBangSanPham(sProd);
  }
  if (!ss.getSheetByName("NoiDungWeb")) {
    var sCfg = ss.insertSheet("NoiDungWeb");
    khoiTaoBangNoiDungWeb(sCfg);
  }
  if (!ss.getSheetByName("DanhGia")) {
    var sRev = ss.insertSheet("DanhGia");
    khoiTaoBangDanhGia(sRev);
  }
}

function doGet(e) {
  var param = (e && e.parameter) || {};
  if (param.action === "get_push_subscriptions") {
    var ss = layBangTinh();
    if (!ss) return jsonSuccess({ subscriptions: [] });
    var sheet = ss.getSheetByName("PushTokens");
    if (!sheet) return jsonSuccess({ subscriptions: [] });
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonSuccess({ subscriptions: [] });
    var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    var list = [];
    for (var i = 0; i < values.length; i++) {
      var endpoint = String(values[i][1] || '').trim();
      var p256dh = String(values[i][2] || '').trim();
      var auth = String(values[i][3] || '').trim();
      if (endpoint && p256dh && auth) {
        list.push({
          endpoint: endpoint,
          keys: {
            p256dh: p256dh,
            auth: auth
          }
        });
      }
    }
    return jsonSuccess({ subscriptions: list });
  }
  return ContentService.createTextOutput("Google Apps Script 2-Way Sync (5 Bảng) & Thông báo Gmail/Zalo/Telegram/Push đang hoạt động tốt!");
}

function doPost(e) {
  try {
    var ss = layBangTinh();
    if (!ss) return jsonError("Không thể mở bảng tính Google Sheet!");
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "";
    var nowStr = data.timestamp || new Date().toLocaleString("vi-VN");

    // ========================================================
    // TẦNG BẢO VỆ CHỐNG BOT SPAM & CÀO DỮ LIỆU (ANTI-BOT & RATE LIMIT)
    // ========================================================
    // 1. Kiểm tra Bẫy Bot Tàng hình (Honeypot Trap)
    // Nếu bot tự động điền trường website_trap_hp -> Phản hồi ảo, không lưu DB & không gửi mail
    if (data.website_trap_hp && String(data.website_trap_hp).trim() !== "") {
      return jsonSuccess({ status: "success", msg: "Bot trap triggered - Ignored", ignored: true });
    }

    // 2. Chống Spam liên tục vào Webhook qua CacheService (Rate limiting 3 giây)
    var isNewSubmission = (data.type === "wholesale" || action === "wholesale" || action === "submit_review" || !action);
    if (isNewSubmission) {
      var phoneRaw = String(data.phone || (data.review && data.review.phone) || "").replace(/\D/g, "");
      if (phoneRaw.length >= 9) {
        try {
          var cache = CacheService.getScriptCache();
          if (cache) {
            var cacheKey = "baco_spam_" + phoneRaw;
            if (cache.get(cacheKey)) {
              return jsonError("Thao tác quá nhanh! Vui lòng chờ 2 giây trước khi gửi tiếp.");
            }
            cache.put(cacheKey, "sent", 3);
          }
        } catch(cErr) {}
      }
    }

    // ========================================================
    // NHÁNH 0: ĐỒNG BỘ BẢNG SẢN PHẨM & BẢNG NỘI DUNG WEBSITE
    // ========================================================

        // 0.3 Lưu Push Subscription (Tab "PushTokens")
    if (action === "save_push_subscription" && data.subscription) {
      var tokenSheet = ss.getSheetByName("PushTokens");
      if (!tokenSheet) {
        tokenSheet = ss.insertSheet("PushTokens");
        tokenSheet.getRange("A1:E1").setValues([["Thời Gian", "Endpoint", "p256dh", "auth", "User Agent"]]);
        tokenSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#e2e8f0");
      }
      var sub = data.subscription;
      var endpoint = sub.endpoint || "";
      var keys = sub.keys || {};
      var p256dh = keys.p256dh || "";
      var auth = keys.auth || "";
      var uAgent = String(data.userAgent || "").slice(0, 200);

      var lastRow = tokenSheet.getLastRow();
      var updated = false;
      if (lastRow >= 2) {
        var existingEndpoints = tokenSheet.getRange(2, 2, lastRow - 1, 1).getValues();
        for (var i = 0; i < existingEndpoints.length; i++) {
          if (existingEndpoints[i][0] === endpoint) {
            tokenSheet.getRange(2 + i, 1, 1, 5).setValues([[nowStr, endpoint, p256dh, auth, uAgent]]);
            updated = true;
            break;
          }
        }
      }
      if (!updated) {
        tokenSheet.appendRow([nowStr, endpoint, p256dh, auth, uAgent]);
      }
      return jsonSuccess({ saved: true });
    }

    // 0.4 Xóa Push Subscription hết hạn
    if (action === "delete_expired_push_subscriptions" && Array.isArray(data.endpoints)) {
      var tokenSheet = ss.getSheetByName("PushTokens");
      if (tokenSheet) {
        var lastRow = tokenSheet.getLastRow();
        if (lastRow >= 2) {
          var epSet = {};
          data.endpoints.forEach(function(ep) { epSet[ep] = true; });
          var rows = tokenSheet.getRange(2, 2, lastRow - 1, 1).getValues();
          for (var i = rows.length - 1; i >= 0; i--) {
            if (epSet[rows[i][0]]) {
              tokenSheet.deleteRow(2 + i);
            }
          }
        }
      }
      return jsonSuccess({ deleted: true });
    }

    // 0.1 Lưu & Kẻ bảng Sản Phẩm (Tab "SanPham")
    if (action === "save_products" && data.products) {
      var prodSheet = ss.getSheetByName("SanPham");
      if (!prodSheet) {
        prodSheet = ss.insertSheet("SanPham");
      } else {
        prodSheet.clear();
      }
      khoiTaoBangSanPham(prodSheet);

      var items = data.products || [];
      for (var pIdx = 0; pIdx < items.length; pIdx++) {
        var p = items[pIdx];
        var targetRow = 3 + pIdx;
        var rowVals = [
          p.id || ("prod_" + (pIdx + 1)),
          p.name || "",
          Number(p.price) || 0,
          p.unit || "Chai 500ml",
          p.category || "Mắm Nhĩ Thượng Hạng",
          p.tag || "Đặc Biệt",
          p.inStock === false ? "Hết hàng" : "Còn hàng",
          p.desc || "",
          p.image || "./pictrure/1.jpg"
        ];
        prodSheet.getRange(targetRow, 1, 1, rowVals.length).setValues([rowVals]);
        dinhDangDongSanPham(prodSheet, targetRow, p.inStock !== false);
      }
      return jsonSuccess({ saved: "SanPham", count: items.length });
    }

    // 0.2 Lưu & Kẻ bảng Nội Dung Website (Tab "NoiDungWeb")
    if (action === "save_site_content" && data.content) {
      var cfgSheet = ss.getSheetByName("NoiDungWeb");
      if (!cfgSheet) {
        cfgSheet = ss.insertSheet("NoiDungWeb");
      } else {
        cfgSheet.clear();
      }
      khoiTaoBangNoiDungWeb(cfgSheet);

      var labelsMap = {
        heroMainTitle: "🌊 1. Banner Đầu - Tiêu đề lớn dòng 1",
        heroSubTitle: "🌊 1. Banner Đầu - Tiêu đề vàng dòng 2",
        heroDesc: "🌊 1. Banner Đầu - Đoạn mô tả ngắn",
        heroBgImg: "🌊 1. Banner Đầu - Ảnh nền biển (Link/Ảnh)",
        heroProductImg: "🌊 1. Banner Đầu - Ảnh chai mắm chính",
        brandName: "📞 2. Thương Hiệu - Tên thương hiệu",
        brandSlogan: "📞 2. Thương Hiệu - Dòng chữ phụ dưới tên",
        brandPhone: "📞 2. Thương Hiệu - Số Hotline & Zalo",
        brandAddress: "📞 2. Thương Hiệu - Địa chỉ cơ sở sản xuất",
        brandEmail: "📞 2. Thương Hiệu - Email liên hệ",
        pillar1Title: "🪵 3. Ba Trụ Cột - Tiêu đề trụ cột 1",
        pillar1Desc: "🪵 3. Ba Trụ Cột - Mô tả trụ cột 1",
        pillar1Img: "🪵 3. Ba Trụ Cột - Hình ảnh trụ cột 1",
        pillar2Title: "🪵 3. Ba Trụ Cột - Tiêu đề trụ cột 2",
        pillar2Desc: "🪵 3. Ba Trụ Cột - Mô tả trụ cột 2",
        pillar2Img: "🪵 3. Ba Trụ Cột - Hình ảnh trụ cột 2",
        pillar3Title: "🪵 3. Ba Trụ Cột - Tiêu đề trụ cột 3",
        pillar3Desc: "🪵 3. Ba Trụ Cột - Mô tả trụ cột 3",
        pillar3Img: "🪵 3. Ba Trụ Cột - Hình ảnh trụ cột 3",
        recipe1Title: "🍲 4. Góc Ẩm Thực - Tên món ăn 1",
        recipe1Desc: "🍲 4. Góc Ẩm Thực - Mô tả món ăn 1",
        recipe1Img: "🍲 4. Góc Ẩm Thực - Hình ảnh món ăn 1",
        recipe2Title: "🍲 4. Góc Ẩm Thực - Tên món ăn 2",
        recipe2Desc: "🍲 4. Góc Ẩm Thực - Mô tả món ăn 2",
        recipe2Img: "🍲 4. Góc Ẩm Thực - Hình ảnh món ăn 2",
        recipe3Title: "🍲 4. Góc Ẩm Thực - Tên món ăn 3",
        recipe3Desc: "🍲 4. Góc Ẩm Thực - Mô tả món ăn 3",
        recipe3Img: "🍲 4. Góc Ẩm Thực - Hình ảnh món ăn 3"
      };

      var keys = Object.keys(data.content);
      for (var kIdx = 0; kIdx < keys.length; kIdx++) {
        var key = keys[kIdx];
        var val = String(data.content[key] || "");
        var r = 3 + kIdx;
        var rowCfg = [
          key,
          val,
          labelsMap[key] || "Cấu hình giao diện",
          nowStr
        ];
        cfgSheet.getRange(r, 1, 1, 4).setValues([rowCfg]);
        dinhDangDongNoiDungWeb(cfgSheet, r);
      }
      return jsonSuccess({ saved: "NoiDungWeb", count: keys.length });
    }

    // ========================================================
    // NHÁNH 1: CÁC LỆNH ĐỒNG BỘ ĐƠN HÀNG & KHÁCH SỈ TỪ ADMIN
    // ========================================================

    // 1.1 Cập nhật trạng thái đơn bán lẻ (Tab 1)
    if (action === "update_order_status") {
      var sheet = ss.getSheets()[0];
      var cleanCode = chuanHoa(data.orderCode);
      var lastRow = sheet.getLastRow();
      if (lastRow >= 3) {
        var codes = sheet.getRange("C3:C" + lastRow).getValues();
        for (var i = 0; i < codes.length; i++) {
          if (chuanHoa(codes[i][0]) === cleanCode) {
            var targetRow = 3 + i;
            var cell = sheet.getRange(targetRow, 12);
            cell.setValue(data.status);
            dinhDangTrangThaiDonHang(cell, data.status);
            return jsonSuccess({ row: targetRow, status: data.status });
          }
        }
      }
      return jsonError("Không tìm thấy mã đơn: " + data.orderCode);
    }

    // 1.2 Xóa đơn hàng bán lẻ (Tab 1)
    if (action === "delete_order") {
      var sheet = ss.getSheets()[0];
      var cleanCode = chuanHoa(data.orderCode);
      var lastRow = sheet.getLastRow();
      if (lastRow >= 3) {
        var codes = sheet.getRange("C3:C" + lastRow).getValues();
        for (var i = 0; i < codes.length; i++) {
          if (chuanHoa(codes[i][0]) === cleanCode) {
            sheet.deleteRow(3 + i);
            return jsonSuccess({ deleted: cleanCode });
          }
        }
      }
      return jsonError("Không tìm thấy mã đơn để xóa: " + data.orderCode);
    }

    // 1.3 Dọn sạch toàn bộ đơn bán lẻ (Tab 1)
    if (action === "clear_all_orders") {
      var sheet = ss.getSheets()[0];
      var lastRow = sheet.getLastRow();
      if (lastRow >= 3) {
        sheet.deleteRows(3, lastRow - 2);
      }
      return jsonSuccess({ cleared: true });
    }

    // 1.4 Cập nhật trạng thái khách sỉ & đại lý (Tab 2)
    if (action === "update_wholesale_status") {
      var wholesaleSheet = ss.getSheetByName("Khách Sỉ & Đại Lý");
      if (wholesaleSheet) {
        var cleanCode = chuanHoa(data.leadCode);
        var lastRow = wholesaleSheet.getLastRow();
        if (lastRow >= 3) {
          var codes = wholesaleSheet.getRange("C3:C" + lastRow).getValues();
          for (var i = 0; i < codes.length; i++) {
            if (chuanHoa(codes[i][0]) === cleanCode) {
              var targetRow = 3 + i;
              var cell = wholesaleSheet.getRange(targetRow, 9);
              cell.setValue(data.status);
              dinhDangTrangThaiDaiLy(cell, data.status);
              return jsonSuccess({ row: targetRow, status: data.status });
            }
          }
        }
      }
      return jsonError("Không tìm thấy mã đại lý: " + data.leadCode);
    }

    // 1.5 Xóa khách sỉ & đại lý (Tab 2)
    if (action === "delete_wholesale") {
      var wholesaleSheet = ss.getSheetByName("Khách Sỉ & Đại Lý");
      if (wholesaleSheet) {
        var cleanCode = chuanHoa(data.leadCode);
        var lastRow = wholesaleSheet.getLastRow();
        if (lastRow >= 3) {
          var codes = wholesaleSheet.getRange("C3:C" + lastRow).getValues();
          for (var i = 0; i < codes.length; i++) {
            if (chuanHoa(codes[i][0]) === cleanCode) {
              wholesaleSheet.deleteRow(3 + i);
              return jsonSuccess({ deleted: cleanCode });
            }
          }
        }
      }
      return jsonError("Không tìm thấy mã đại lý để xóa: " + data.leadCode);
    }

    // 1.6 Dọn sạch toàn bộ khách sỉ & đại lý (Tab 2)
    if (action === "clear_all_wholesale") {
      var wholesaleSheet = ss.getSheetByName("Khách Sỉ & Đại Lý");
      if (wholesaleSheet) {
        var lastRow = wholesaleSheet.getLastRow();
        if (lastRow >= 3) {
          wholesaleSheet.deleteRows(3, lastRow - 2);
        }
      }
      return jsonSuccess({ cleared: true });
    }

    // ========================================================
    // NHÁNH 2: GHI ĐƠN MỚI TỪ TRANG WEB & BẮN GMAIL + ZALO
    // ========================================================

    // 2.1 Đăng ký khách sỉ & đại lý
    if (data.type === "wholesale" || action === "wholesale") {
      var wholesaleSheet = ss.getSheetByName("Khách Sỉ & Đại Lý");
      if (!wholesaleSheet) {
        wholesaleSheet = ss.insertSheet("Khách Sỉ & Đại Lý");
        khoiTaoBangKhachSi(wholesaleSheet);
      }

      var lastRow = wholesaleSheet.getLastRow();
      var targetRow = Math.max(lastRow + 1, 3);
      var stt = targetRow - 2;
      var leadCode = data.leadCode || ("#DL" + Math.floor(Math.random()*899999 + 100000));

      var rowData = [
        stt,
        nowStr,
        leadCode,
        data.name || "Chưa có tên",
        "'" + (data.phone || ""),
        data.area || "Toàn quốc",
        data.businessModel || "Đại lý phân phối",
        data.note || "",
        data.status || "Chờ gọi tư vấn"
      ];

      wholesaleSheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
      dinhDangDongKhachSi(wholesaleSheet, targetRow);

      // 🔔 GỬI EMAIL THÔNG BÁO TỨC THÌ KÈM NÚT MỞ ZALO CHAT
      sendWholesaleEmail(data, leadCode, nowStr);
      sendTelegramWholesale(data, leadCode, nowStr);
      sendServerWebPush(data, leadCode, "wholesale");

      return jsonSuccess({ type: "wholesale", row: targetRow });
    }

    // 2.2 Khách gửi đánh giá & cảm nhận mới (Tab "DanhGia")
    if (action === "submit_review" && data.review) {
      var revSheet = ss.getSheetByName("DanhGia");
      if (!revSheet) {
        revSheet = ss.insertSheet("DanhGia");
        khoiTaoBangDanhGia(revSheet);
      }

      var r = data.review;
      var lastRowRev = revSheet.getLastRow();
      var targetRowRev = Math.max(lastRowRev + 1, 3);
      var sttRev = targetRowRev - 2;

      var rowRev = [
        sttRev,
        nowStr,
        r.id || ("REV-" + Date.now().toString().slice(-6)),
        r.name || "Khách mua online",
        "'" + (r.phone || ""),
        r.location || "Toàn quốc",
        r.product || "Nước mắm Ba Cô",
        Number(r.rating) || 5,
        (r.tags || []).join(", "),
        r.comment || "",
        r.status || "approved"
      ];

      revSheet.getRange(targetRowRev, 1, 1, rowRev.length).setValues([rowRev]);
      dinhDangDongDanhGia(revSheet, targetRowRev);

      // 🔔 GỬI EMAIL THÔNG BÁO ĐÁNH GIÁ MỚI KÈM NÚT MỞ ZALO CẢM ƠN
      sendReviewEmail(r, nowStr);

      return jsonSuccess({ type: "review", row: targetRowRev });
    }

    // 2.3 Đơn hàng bán lẻ từ B7 (Tab 1)
    var sheet = ss.getSheets()[0];
    var targetRow = timDongTrong(sheet);
    var orderCode = data.orderCode || ("#BC" + Math.floor(Math.random()*899999 + 100000));

    var rowData = [
      nowStr,
      orderCode,
      data.name || "",
      "'" + (data.phone || ""),
      data.address || "",
      data.product || "",
      Number(data.quantity) || 1,
      Number(data.totalAmount) || 0,
      data.paymentMethod || "COD",
      data.note || "",
      data.status || "Chờ xác nhận"
    ];

    sheet.getRange(targetRow, 2, 1, rowData.length).setValues([rowData]);
    dinhDangDongDonHang(sheet, targetRow);

    // 🔔 GỬI EMAIL THÔNG BÁO ĐƠN HÀNG MỚI TỨC THÌ KÈM NÚT MỞ ZALO CHAT
    sendOrderEmail(data, orderCode, nowStr);
    sendTelegramNotification(data, orderCode, nowStr);
    sendServerWebPush(data, orderCode, "orders");

    return jsonSuccess({ type: "retail", row: targetRow });

  } catch (error) {
    return jsonError(error.toString());
  }
}

// ========================================================
// HÀM GỬI EMAIL THÔNG BÁO TỰ ĐỘNG VỀ GMAIL + NÚT MỞ ZALO
// ========================================================

function sendOrderEmail(d, code, timeStr) {
  if (!ADMIN_EMAIL || ADMIN_EMAIL.indexOf("@") === -1) return;
  var phoneClean = String(d.phone || "").replace(/\D/g, "");
  var zaloLink = phoneClean ? "https://zalo.me/" + phoneClean : "";
  var callLink = phoneClean ? "tel:" + phoneClean : "";
  var totalFormatted = Number(d.totalAmount || 0).toLocaleString("vi-VN") + " đ";

  var subject = "🔔 [ĐƠN HÀNG MỚI #" + code + "] - " + totalFormatted + " từ " + (d.name || "Khách lẻ");

  var htmlBody = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">' +
    '<div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 20px; text-align: center; color: #ffffff;">' +
      '<h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px; color: #fbbf24;">Nước Mắm Truyền Thống Ba Cô</h2>' +
      '<p style="margin: 5px 0 0; font-size: 14px; color: #94a3b8;">Thông báo đơn hàng bán lẻ mới</p>' +
    '</div>' +
    '<div style="padding: 24px;">' +
      '<div style="background: #f8fafc; border-left: 4px solid #f59e0b; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">' +
        '<span style="font-size: 13px; color: #64748b;">Mã Đơn Hàng:</span> ' +
        '<strong style="font-size: 16px; color: #0f172a;">#' + code + '</strong>' +
        '<div style="font-size: 12px; color: #64748b; margin-top: 4px;">Thời gian: ' + timeStr + '</div>' +
      '</div>' +
      '<table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">' +
        '<tr><td style="padding: 8px 0; color: #64748b; width: 130px;">Khách Hàng:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a;">' + (d.name || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Số Điện Thoại:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; font-size: 16px;">' + (d.phone || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Địa Chỉ Giao:</td><td style="padding: 8px 0; color: #0f172a;">' + (d.address || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Sản Phẩm Đặt:</td><td style="padding: 8px 0; font-weight: bold; color: #047857;">' + (d.product || "") + ' (SL: ' + (d.quantity || 1) + ')</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Tổng Tiền:</td><td style="padding: 8px 0; font-weight: bold; font-size: 18px; color: #b45309;">' + totalFormatted + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Thanh Toán:</td><td style="padding: 8px 0; color: #0f172a;">' + (d.paymentMethod || "COD") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Ghi Chú:</td><td style="padding: 8px 0; color: #64748b; font-style: italic;">' + (d.note || "Không có") + '</td></tr>' +
      '</table>' +
      (zaloLink ? 
        '<div style="text-align: center; padding-top: 15px; border-top: 1px dashed #cbd5e1;">' +
          '<p style="font-size: 13px; color: #475569; margin-bottom: 12px; font-weight: bold;">⚡ HÀNH ĐỘNG NHANH VỚI KHÁCH HÀNG:</p>' +
          '<a href="' + zaloLink + '" target="_blank" style="display: inline-block; background: #0068ff; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 24px; border-radius: 8px; margin: 4px; box-shadow: 0 2px 4px rgba(0,104,255,0.3);">' +
            '💬 MỞ ZALO NHẮN CHO KHÁCH NGAY' +
          '</a>' +
          '<a href="' + callLink + '" style="display: inline-block; background: #10b981; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 20px; border-radius: 8px; margin: 4px;">' +
            '📞 GỌI ĐIỆN CHO KHÁCH' +
          '</a>' +
        '</div>' : '') +
    '</div>' +
    '<div style="background: #f1f5f9; padding: 12px; text-align: center; font-size: 11px; color: #94a3b8;">' +
      'Email thông báo tự động từ Hệ Thống Quản Trị Ba Cô Khánh Hòa' +
    '</div>' +
  '</div>';

  try {
    MailApp.sendEmail({ to: ADMIN_EMAIL, subject: subject, htmlBody: htmlBody });
  } catch(err) {
    Logger.log("Lỗi gửi email đơn hàng: " + err);
  }
}

function sendWholesaleEmail(d, code, timeStr) {
  if (!ADMIN_EMAIL || ADMIN_EMAIL.indexOf("@") === -1) return;
  var phoneClean = String(d.phone || "").replace(/\D/g, "");
  var zaloLink = phoneClean ? "https://zalo.me/" + phoneClean : "";
  var callLink = phoneClean ? "tel:" + phoneClean : "";

  var subject = "🤝 [KHÁCH SỈ / ĐẠI LÝ MỚI " + code + "] - " + (d.name || "") + " (" + (d.area || "") + ")";

  var htmlBody = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">' +
    '<div style="background: linear-gradient(135deg, #4c1d95, #6d28d9); padding: 20px; text-align: center; color: #ffffff;">' +
      '<h2 style="margin: 0; font-size: 20px; text-transform: uppercase; color: #fde047;">Ba Cô Khánh Hòa</h2>' +
      '<p style="margin: 5px 0 0; font-size: 14px; color: #e9d5ff;">Yêu cầu hợp tác phân phối / Khách sỉ mới</p>' +
    '</div>' +
    '<div style="padding: 24px;">' +
      '<table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">' +
        '<tr><td style="padding: 8px 0; color: #64748b; width: 130px;">Đối Tác:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; font-size: 16px;">' + (d.name || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Số Điện Thoại:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; font-size: 16px;">' + (d.phone || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Khu Vực:</td><td style="padding: 8px 0; font-weight: bold; color: #7c3aed;">' + (d.area || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Mô Hình:</td><td style="padding: 8px 0; color: #0f172a;">' + (d.businessModel || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Nhu Cầu:</td><td style="padding: 8px 0; color: #0f172a; font-style: italic;">' + (d.note || "Không có") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Thời Gian:</td><td style="padding: 8px 0; color: #64748b;">' + timeStr + '</td></tr>' +
      '</table>' +
      (zaloLink ? 
        '<div style="text-align: center; padding-top: 15px; border-top: 1px dashed #cbd5e1;">' +
          '<a href="' + zaloLink + '" target="_blank" style="display: inline-block; background: #0068ff; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 24px; border-radius: 8px; margin: 4px;">' +
            '💬 MỞ ZALO BÁO GIÁ CHO ĐỐI TÁC' +
          '</a>' +
          '<a href="' + callLink + '" style="display: inline-block; background: #10b981; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 20px; border-radius: 8px; margin: 4px;">' +
            '📞 GỌI ĐIỆN THOẠI NGAY' +
          '</a>' +
        '</div>' : '') +
    '</div>' +
  '</div>';

  try {
    MailApp.sendEmail({ to: ADMIN_EMAIL, subject: subject, htmlBody: htmlBody });
  } catch(err) {
    Logger.log("Lỗi gửi email khách sỉ: " + err);
  }
}

function sendReviewEmail(r, timeStr) {
  if (!ADMIN_EMAIL || ADMIN_EMAIL.indexOf("@") === -1) return;
  var phoneClean = String(r.phone || "").replace(/\D/g, "");
  var zaloLink = phoneClean ? "https://zalo.me/" + phoneClean : "";
  var starIcons = "★★★★★".slice(0, Number(r.rating) || 5);

  var subject = "⭐ [ĐÁNH GIÁ MỚI " + starIcons + "] - " + (r.name || "Khách online") + " (" + (r.product || "") + ")";

  var htmlBody = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">' +
    '<div style="background: linear-gradient(135deg, #d97706, #b45309); padding: 18px; text-align: center; color: #ffffff;">' +
      '<h2 style="margin: 0; font-size: 18px; text-transform: uppercase;">Ba Cô Khánh Hòa</h2>' +
      '<p style="margin: 4px 0 0; font-size: 13px; color: #fef3c7;">Khách hàng vừa gửi đánh giá cảm nhận sản phẩm</p>' +
    '</div>' +
    '<div style="padding: 20px;">' +
      '<div style="text-align: center; margin-bottom: 15px;">' +
        '<div style="font-size: 26px; color: #f59e0b; font-weight: bold;">' + starIcons + ' (' + (r.rating || 5) + '/5 sao)</div>' +
        '<div style="font-size: 14px; color: #047857; font-weight: bold; margin-top: 4px;">' + (r.product || "Nước mắm Ba Cô") + '</div>' +
      '</div>' +
      '<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 16px; font-style: italic; color: #334155; font-size: 14px;">' +
        '"' + (r.comment || "") + '"' +
      '</div>' +
      '<p style="font-size: 13px; color: #64748b; margin: 4px 0;"><strong>Khách hàng:</strong> ' + (r.name || "") + ' (' + (r.phone || "") + ') - ' + (r.location || "") + '</p>' +
      '<p style="font-size: 13px; color: #64748b; margin: 4px 0;"><strong>Tiêu chí:</strong> ' + ((r.tags || []).join(', ') || "Không chọn") + '</p>' +
      (zaloLink ? 
        '<div style="text-align: center; padding-top: 15px; margin-top: 15px; border-top: 1px dashed #cbd5e1;">' +
          '<a href="' + zaloLink + '" target="_blank" style="display: inline-block; background: #0068ff; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 13px; padding: 10px 20px; border-radius: 8px;">' +
            '💬 MỞ ZALO NHẮN TIN CẢM ƠN KHÁCH' +
          '</a>' +
        '</div>' : '') +
    '</div>' +
  '</div>';

  try {
    MailApp.sendEmail({ to: ADMIN_EMAIL, subject: subject, htmlBody: htmlBody });
  } catch(err) {
    Logger.log("Lỗi gửi email đánh giá: " + err);
  }
}

// ========================================================
// CÁC HÀM KẺ BẢNG & ĐỊNH DẠNG CHO BẢNG SẢN PHẨM & NỘI DUNG WEB
// ========================================================

function khoiTaoBangSanPham(sheet) {
  sheet.getRange("A1:I1").merge()
       .setValue("DANH SÁCH SẢN PHẨM KINH DOANH - NƯỚC MẮM BA CÔ KHÁNH HÒA")
       .setBackground("#b45309").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  var headers = ["Mã SP", "Tên Sản Phẩm", "Giá Bán (VNĐ)", "Quy Cách", "Dòng Sản Phẩm", "Huy Hiệu", "Trạng Thái Kho", "Mô Tả Chi Tiết", "Hình Ảnh (Link / Dữ Liệu)"];
  sheet.getRange("A2:I2").setValues([headers])
       .setBackground("#fef3c7").setFontColor("#78350f").setFontWeight("bold").setFontSize(10).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(2, 34);

  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 240);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 160);
  sheet.setColumnWidth(6, 120);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 280);
  sheet.setColumnWidth(9, 220);
}

function dinhDangDongSanPham(sheet, row, inStock) {
  var range = sheet.getRange(row, 1, 1, 9);
  range.setFontFamily("Roboto").setFontSize(10).setVerticalAlignment("middle");
  range.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(row, 38);

  var stockBg = inStock ? "#dcfce7" : "#fee2e2";
  var stockColor = inStock ? "#15803d" : "#b91c1c";

  range.setBackgrounds([["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#f0fdfa", "#fffbeb", stockBg, "#ffffff", "#f8fafc"]]);
  range.setFontColors([["#64748b", "#0f172a", "#b45309", "#334155", "#0f766e", "#b45309", stockColor, "#475569", "#64748b"]]);
  range.setHorizontalAlignments([["center", "left", "right", "center", "center", "center", "center", "left", "left"]]);
  range.setFontWeights([["bold", "bold", "bold", "normal", "bold", "bold", "bold", "normal", "normal"]]);
  sheet.getRange(row, 3).setNumberFormat("#,##0 \"đ\"");
}

function khoiTaoBangNoiDungWeb(sheet) {
  sheet.getRange("A1:D1").merge()
       .setValue("BẢNG QUẢN LÝ NỘI DUNG & HÌNH ẢNH WEBSITE - NƯỚC MẮM BA CÔ KHÁNH HÒA")
       .setBackground("#0f766e").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  var headers = ["Mã Mục (Key)", "Nội Dung / Hình Ảnh Đang Hiển Thị", "Thư Mục / Vị Trí Trên Website", "Cập Nhật Lúc"];
  sheet.getRange("A2:D2").setValues([headers])
       .setBackground("#ccfbf1").setFontColor("#115e59").setFontWeight("bold").setFontSize(10).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(2, 34);

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 380);
  sheet.setColumnWidth(3, 260);
  sheet.setColumnWidth(4, 150);
}

function dinhDangDongNoiDungWeb(sheet, row) {
  var range = sheet.getRange(row, 1, 1, 4);
  range.setFontFamily("Roboto").setFontSize(10).setVerticalAlignment("middle");
  range.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(row, 34);

  range.setBackgrounds([["#f8fafc", "#ffffff", "#f0fdfa", "#ffffff"]]);
  range.setFontColors([["#475569", "#0f172a", "#0f766e", "#64748b"]]);
  range.setHorizontalAlignments([["left", "left", "left", "center"]]);
  range.setFontWeights([["bold", "normal", "bold", "normal"]]);
}

// ========================================================
// KẺ BẢNG & ĐỊNH DẠNG CHO BẢNG ĐÁNH GIÁ (TAB "DanhGia")
// ========================================================

function khoiTaoBangDanhGia(sheet) {
  sheet.getRange("A1:K1").merge()
       .setValue("DANH SÁCH ĐÁNH GIÁ & CẢM NHẬN KHÁCH HÀNG - NƯỚC MẮM BA CÔ")
       .setBackground("#0369a1").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  var headers = ["STT", "Thời Gian", "Mã Đánh Giá", "Họ Tên Khách", "SĐT", "Khu Vực", "Sản Phẩm Đánh Giá", "Số Sao", "Tiêu Chí Nổi Bật", "Nội Dung Cảm Nhận", "Trạng Thái"];
  sheet.getRange("A2:K2").setValues([headers])
       .setBackground("#e0f2fe").setFontColor("#075985").setFontWeight("bold").setFontSize(10).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(2, 34);

  sheet.setColumnWidth(1, 50);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 160);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 200);
  sheet.setColumnWidth(8, 80);
  sheet.setColumnWidth(9, 200);
  sheet.setColumnWidth(10, 280);
  sheet.setColumnWidth(11, 100);
}

function dinhDangDongDanhGia(sheet, row) {
  var range = sheet.getRange(row, 1, 1, 11);
  range.setFontFamily("Roboto").setFontSize(10).setVerticalAlignment("middle");
  range.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(row, 36);

  range.setBackgrounds([["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#f0fdfa", "#fffbeb", "#f8fafc", "#ffffff", "#dcfce7"]]);
  range.setFontColors([["#64748b", "#475569", "#0369a1", "#0f172a", "#0284c7", "#334155", "#0f766e", "#b45309", "#475569", "#0f172a", "#15803d"]]);
  range.setHorizontalAlignments([["center", "center", "center", "left", "center", "left", "left", "center", "left", "left", "center"]]);
  range.setFontWeights([["normal", "normal", "bold", "bold", "bold", "normal", "bold", "bold", "normal", "normal", "bold"]]);
}

// ========================================================
// CÁC HÀM TIỆN ÍCH ĐƠN HÀNG & KHÁCH SỈ (GIỮ NGUYÊN)
// ========================================================

function chuanHoa(str) {
  return String(str || "").replace(/#/g, "").trim().toLowerCase();
}

function jsonSuccess(obj) {
  obj.status = "success";
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function jsonError(msg) {
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: msg })).setMimeType(ContentService.MimeType.JSON);
}

function timDongTrong(sheet) {
  var startRow = 7;
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return startRow;
  var colB = sheet.getRange("B" + startRow + ":B" + (lastRow + 10)).getValues();
  for (var i = 0; i < colB.length; i++) {
    if (colB[i][0] === "" || colB[i][0] === null || colB[i][0] === undefined) {
      return startRow + i;
    }
  }
  return startRow + colB.length;
}

function dinhDangDongDonHang(sheet, row) {
  var range = sheet.getRange(row, 2, 1, 11);
  range.setFontFamily("Roboto").setFontSize(10).setVerticalAlignment("middle");
  range.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(row, 36);

  range.setBackgrounds([["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#fef3c7"]]);
  range.setFontColors([["#475569", "#b45309", "#0f172a", "#0284c7", "#334155", "#0f172a", "#0f172a", "#15803d", "#64748b", "#64748b", "#b45309"]]);
  range.setHorizontalAlignments([["center", "center", "left", "center", "left", "left", "center", "right", "center", "left", "center"]]);
  range.setFontWeights([["normal", "bold", "bold", "bold", "normal", "normal", "bold", "bold", "normal", "normal", "bold"]]);

  sheet.getRange(row, 9).setNumberFormat("#,##0 \"đ\"");
  sheet.getRange(row, 8).setNumberFormat("#,##0");
}

function dinhDangTrangThaiDonHang(cell, status) {
  var s = String(status || "").toLowerCase();
  if (s.indexOf("nhận") !== -1 || s.indexOf("thanh toán") !== -1) {
    cell.setBackground("#dcfce7").setFontColor("#15803d").setFontWeight("bold");
  } else if (s.indexOf("giao") !== -1) {
    cell.setBackground("#dbeafe").setFontColor("#1d4ed8").setFontWeight("bold");
  } else if (s.indexOf("hoàn") !== -1 || s.indexOf("tất") !== -1) {
    cell.setBackground("#f1f5f9").setFontColor("#475569").setFontWeight("bold");
  } else {
    cell.setBackground("#fef3c7").setFontColor("#b45309").setFontWeight("bold");
  }
}

function dinhDangTrangThaiDaiLy(cell, status) {
  var s = String(status || "").toLowerCase();
  if (s.indexOf("liên hệ") !== -1 || s.indexOf("tư vấn") !== -1) {
    cell.setBackground("#e0f2fe").setFontColor("#0369a1").setFontWeight("bold");
  } else if (s.indexOf("hợp đồng") !== -1 || s.indexOf("hđ") !== -1 || s.indexOf("thành công") !== -1) {
    cell.setBackground("#dcfce7").setFontColor("#15803d").setFontWeight("bold");
  } else if (s.indexOf("từ chối") !== -1 || s.indexOf("hủy") !== -1) {
    cell.setBackground("#fee2e2").setFontColor("#b91c1c").setFontWeight("bold");
  } else {
    cell.setBackground("#fef3c7").setFontColor("#b45309").setFontWeight("bold");
  }
}

function khoiTaoBangKhachSi(sheet) {
  sheet.getRange("A1:I1").merge()
       .setValue("DANH SÁCH ĐĂNG KÝ KHÁCH SỈ & ĐẠI LÝ PHÂN PHỐI - NƯỚC MẮM BA CÔ")
       .setBackground("#581c87").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  var headers = ["STT", "Thời Gian", "Mã Đại Lý", "Họ Tên", "SĐT / Zalo", "Khu Vực", "Mô Hình", "Ghi Chú Nhu Cầu", "Trạng Thái"];
  var headerRange = sheet.getRange("A2:I2");
  headerRange.setValues([headers])
             .setBackground("#ede9fe").setFontColor("#4c1d95").setFontWeight("bold").setFontSize(10).setFontFamily("Roboto")
             .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(2, 34);

  sheet.setColumnWidth(1, 50);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 160);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 160);
  sheet.setColumnWidth(7, 180);
  sheet.setColumnWidth(8, 220);
  sheet.setColumnWidth(9, 140);
}

function dinhDangDongKhachSi(sheet, row) {
  var range = sheet.getRange(row, 1, 1, 9);
  range.setFontFamily("Roboto").setFontSize(10).setVerticalAlignment("middle");
  range.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(row, 36);

  range.setBackgrounds([["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#fef3c7"]]);
  range.setFontColors([["#64748b", "#475569", "#7e22ce", "#0f172a", "#0284c7", "#334155", "#0f172a", "#64748b", "#b45309"]]);
  range.setHorizontalAlignments([["center", "center", "center", "left", "center", "left", "left", "left", "center"]]);
  range.setFontWeights([["normal", "normal", "bold", "bold", "bold", "normal", "normal", "normal", "bold"]]);
}

// ========================================================
// HỆ THỐNG THÔNG BÁO TELEGRAM BOT (ĐẨY KHÓA MÀN HÌNH TỨC THÌ)
// ========================================================
const TELEGRAM_BOT_TOKEN = ""; // Điền Token từ @BotFather (VD: 123456:ABC-DEF...)
const TELEGRAM_CHAT_ID = "";   // Điền Chat ID cá nhân nhận tin nhắn

function sendTelegramNotification(d, code, timeStr) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    var totalFormatted = Number(d.totalAmount || 0).toLocaleString("vi-VN") + " đ";
    var msg = "🔔 *CÓ ĐƠN HÀNG MỚI #" + code + "*\n\n" +
              "👤 *Khách hàng:* " + (d.name || "Khách lẻ") + "\n" +
              "📞 *Số điện thoại:* " + (d.phone || "Chưa có") + "\n" +
              "📍 *Địa chỉ:* " + (d.address || "Chưa có") + "\n" +
              "🛒 *Sản phẩm:* " + (d.product || "Nước mắm") + " (x" + (d.quantity || 1) + ")\n" +
              "💰 *Tổng tiền:* *" + totalFormatted + "* (" + (d.paymentMethod || "COD") + ")\n" +
              "⏰ *Thời gian:* " + timeStr + "\n\n" +
              "👉 [Bấm Vào Đây Để Mở Trang Quản Trị](https://mambacokhanhhoa.pages.dev/admin.html)";

    var url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: "Markdown"
      }),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log("Telegram Error: " + e.toString());
  }
}

function sendTelegramWholesale(d, code, timeStr) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    var msg = "🤝 *ĐẠI LÝ SỈ MỚI ĐĂNG KÝ #" + code + "*\n\n" +
              "👤 *Đối tác:* " + (d.name || "Khách sỉ") + "\n" +
              "📞 *SĐT / Zalo:* " + (d.phone || "Chưa có") + "\n" +
              "📍 *Khu vực:* " + (d.area || "Toàn quốc") + "\n" +
              "🏢 *Mô hình:* " + (d.businessModel || "Đại lý") + "\n" +
              "📝 *Nhu cầu:* " + (d.note || "Tư vấn bảng giá") + "\n" +
              "⏰ *Thời gian:* " + timeStr + "\n\n" +
              "👉 [Bấm Vào Đây Để Mở Trang Quản Trị](https://mambacokhanhhoa.pages.dev/admin.html)";

    var url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: "Markdown"
      }),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log("Telegram Wholesale Error: " + e.toString());
  }
}

// ========================================================
// HỆ THỐNG GỬI WEB PUSH THẲNG TỪ GOOGLE CLOUD VỀ ĐIỆN THOẠI
// ========================================================
function sendServerWebPush(d, code, type) {
  try {
    var url = "https://mambacokhanhhoa.vercel.app/api/send-push";
    var title = "";
    var body = "";
    if (type === "wholesale") {
      title = "🤝 Khách Sỉ Mới #" + code;
      body = (d.name || "Khách sỉ") + " (" + (d.phone || "") + ") đăng ký tại " + (d.area || "Toàn quốc");
    } else {
      var totalFormatted = Number(d.totalAmount || 0).toLocaleString("vi-VN") + "đ";
      title = "🛒 Đơn Hàng Mới #" + code + " - " + totalFormatted;
      body = (d.name || "Khách hàng") + " (" + (d.phone || "") + ") vừa đặt: " + (d.product || "Nước mắm") + " - " + (d.address || "");
    }
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        title: title,
        body: body,
        url: "./admin.html",
        code: code,
        type: type || "orders"
      }),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log("Lỗi sendServerWebPush: " + e.toString());
  }
}

