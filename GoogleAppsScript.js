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

  // KIỂM TRA TRẠNG THÁI THANH TOÁN TỨC THÌ (CHO KHÁCH QUÉT QR SEPAY)
  if (param.action === "check_payment" || param.action === "check_payment_status") {
    var checkCode = chuanHoa(param.orderCode || param.order_id || param.code);
    if (!checkCode) return jsonSuccess({ paid: false, payment_status: "Unpaid", message: "Thiếu orderCode" });

    // 1. Kiểm tra trong Script Properties
    try {
      var props = PropertiesService.getScriptProperties();
      var pVal = props.getProperty("PAID_" + checkCode);
      if (pVal) {
        var pData = JSON.parse(pVal);
        return jsonSuccess({
          paid: true,
          payment_status: "Paid",
          orderCode: checkCode,
          amount: pData.amount || 0,
          paidAt: pData.time || "",
          source: "script_properties"
        });
      }
    } catch(errProp) {}

    // 2. Kiểm tra trong Tab 1 (Đơn bán lẻ)
    try {
      var ss = layBangTinh();
      if (ss) {
        var sheet = ss.getSheets()[0];
        var lastRow = sheet.getLastRow();
        if (lastRow >= 3) {
          var rows = sheet.getRange("C3:L" + lastRow).getValues();
          for (var i = 0; i < rows.length; i++) {
            var rCode = chuanHoa(rows[i][0]);
            var rStatus = String(rows[i][9] || "").toLowerCase();
            if (rCode === checkCode || (rCode && checkCode && (rCode.indexOf(checkCode) !== -1 || checkCode.indexOf(rCode) !== -1))) {
              if (rStatus.indexOf("nhận") !== -1 || rStatus.indexOf("thanh toán") !== -1 || rStatus.indexOf("paid") !== -1) {
                return jsonSuccess({
                  paid: true,
                  payment_status: "Paid",
                  orderCode: checkCode,
                  status: rows[i][9],
                  source: "google_sheet"
                });
              }
            }
          }
        }
      }
    } catch(errSheet) {}

    return jsonSuccess({ paid: false, payment_status: "Unpaid", orderCode: checkCode });
  }

  if (param.action === "lookup_order") {
    return lookupOrderInSheet_(param.orderCode, param.phone);
  }
  if (param.action === "get_vouchers") {
    return jsonSuccess({ vouchers: getVouchersList_() });
  }
  if (param.action === "verify_voucher") {
    return handleVerifyVoucher_(param.code, Number(param.subtotal || 0));
  }
  return ContentService.createTextOutput("Google Apps Script 2-Way Sync (Secured) đang hoạt động tốt!");
}

function doPost(e) {
  var lock = null;
  try {
    var ss = layBangTinh();
    if (!ss) return jsonError("Không thể mở bảng tính Google Sheet!");
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "";
    var nowStr = data.timestamp || new Date().toLocaleString("vi-VN");

    // XÁC THỰC QUẢN TRỊ VIÊN & QUẢN LÝ PHIÊN (SESSION LIFECYCLE)
    if (action === "verify_admin") {
      return handleVerifyAdmin_(data, nowStr);
    }
    if (action === "verify_session") {
      return handleVerifySession_(data);
    }
    if (action === "refresh_session") {
      return handleRefreshSession_(data);
    }
    if (action === "logout" || action === "revoke_session") {
      return handleLogoutSession_(data);
    }
    if (action === "revoke_all_sessions") {
      return handleRevokeAllSessions_(data);
    }

    // TRA CỨU ĐƠN HÀNG & KIỂM TRA VOUCHER (CÔNG KHAI CÓ GIỚI HẠN)
    if (action === "lookup_order") {
      return lookupOrderInSheet_(data.orderCode, data.phone);
    }
    if (action === "get_vouchers") {
      return jsonSuccess({ vouchers: getVouchersList_() });
    }
    if (action === "verify_voucher") {
      return handleVerifyVoucher_(data.code, Number(data.subtotal) || 0);
    }

    // ĐỌC DỮ LIỆU QUẢN TRỊ & PUSH SUBSCRIPTIONS (BẮT BUỘC XÁC THỰC SERVER-SIDE)
    if (action === "get_admin_dashboard_data") {
      var authRead = requireAdminSession_(data);
      if (!authRead.ok) return jsonError(authRead.message);
      return getAdminDashboardData_(ss);
    }
    if (action === "get_push_subscriptions") {
      var secPush = getOrCreateSecurityProps_();
      var hasApiSecret = data.adminApiSecret && constantTimeEqual_(String(data.adminApiSecret), secPush.ADMIN_API_SECRET);
      if (!hasApiSecret) {
        var authPush = requireAdminSession_(data);
        if (!authPush.ok) return jsonError(authPush.message);
      }
      return getPushSubscriptionsData_(ss);
    }

    // Khóa ghi đồng thời chống xung đột dòng khi có nhiều đơn hàng cùng lúc
    var isWriteOp = !action || action === "wholesale" || data.type === "wholesale" ||
                    action === "submit_review" || action === "update_order_status" ||
                    action === "delete_order" || action === "clear_all_orders" ||
                    action === "update_wholesale_status" || action === "delete_wholesale" ||
                    action === "clear_all_wholesale" || action === "save_products" ||
                    action === "save_vouchers" || action === "save_site_content" ||
                    action === "save_reviews" || action === "sync_customers_crm" ||
                    action === "sepay_webhook";
    if (isWriteOp) {
      try {
        lock = LockService.getScriptLock();
        lock.tryLock(8000);
      } catch (lockErr) { lock = null; }
    }

    // ========================================================
    // TẦNG BẢO VỆ CHỐNG BOT SPAM & CÀO DỮ LIỆU (ANTI-BOT & RATE LIMIT)
    // ========================================================
    if (data.website_trap_hp && String(data.website_trap_hp).trim() !== "") {
      return jsonSuccess({ status: "success", msg: "Bot trap triggered - Ignored", ignored: true });
    }

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
    // NHÁNH 0: CÁC LỆNH QUẢN TRỊ HỆ THỐNG (BẮT BUỘC SESSION TOKEN HỢP LỆ)
    // ========================================================

    // 0.3 Lưu Push Subscription (Tab "PushTokens") - Chỉ Admin đã xác thực
    if (action === "save_push_subscription" && data.subscription) {
      var authSub = requireAdminSession_(data);
      if (!authSub.ok) return jsonError(authSub.message);
      var tokenSheet = ss.getSheetByName("PushTokens");
      if (!tokenSheet) {
        tokenSheet = ss.insertSheet("PushTokens");
        tokenSheet.getRange("A1:E1").setValues([["Thời Gian", "Endpoint", "p256dh", "auth", "User Agent"]]);
        tokenSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#e2e8f0");
      }
      var sub = data.subscription;
      var endpoint = String(sub.endpoint || "").slice(0, 500);
      var keys = sub.keys || {};
      var p256dh = String(keys.p256dh || "").slice(0, 300);
      var auth = String(keys.auth || "").slice(0, 300);
      var uAgent = sanitizeSheetCell_(String(data.userAgent || "").slice(0, 200));

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

    // 0.4 Xóa Push Subscription hết hạn - Chỉ Admin hoặc API Secret
    if (action === "delete_expired_push_subscriptions" && Array.isArray(data.endpoints)) {
      var secDelPush = getOrCreateSecurityProps_();
      var hasDelSecret = data.adminApiSecret && constantTimeEqual_(String(data.adminApiSecret), secDelPush.ADMIN_API_SECRET);
      if (!hasDelSecret) {
        var authDelPush = requireAdminSession_(data);
        if (!authDelPush.ok) return jsonError(authDelPush.message);
      }
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

    // 0.1 Lưu & Kẻ bảng Sản Phẩm (Tab "SanPham") - Chỉ Admin
    if (action === "save_products" && data.products) {
      var authProd = requireAdminSession_(data);
      if (!authProd.ok) return jsonError(authProd.message);
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
        var hasStockField = (p.stock !== undefined && p.stock !== null && p.stock !== "");
        var stockNum = hasStockField ? Math.max(0, Math.floor(Number(p.stock) || 0)) : (p.inStock === false ? 0 : 100);
        var isAvail = (p.inStock !== false) && (stockNum > 0);
        var rowVals = [
          p.id || ("prod_" + (pIdx + 1)),
          p.name || "",
          Number(p.price) || 0,
          p.unit || "Chai 500ml",
          p.category || "Mắm Nhĩ Thượng Hạng",
          p.tag || "Đặc Biệt",
          isAvail ? "Còn hàng" : "Hết hàng",
          p.desc || "",
          p.image || "./pictrure/1.jpg",
          stockNum
        ];
        prodSheet.getRange(targetRow, 1, 1, rowVals.length).setValues([rowVals]);
        dinhDangDongSanPham(prodSheet, targetRow, isAvail);
      }
      return jsonSuccess({ saved: "SanPham", count: items.length });
    }

    // 0.2 Lưu & Kẻ bảng Nội Dung Website (Tab "NoiDungWeb") - Chỉ Admin
    if (action === "save_site_content" && data.content) {
      var authCfg = requireAdminSession_(data);
      if (!authCfg.ok) return jsonError(authCfg.message);
      var cfgSheet = ss.getSheetByName("NoiDungWeb");
      if (!cfgSheet) {
        cfgSheet = ss.insertSheet("NoiDungWeb");
      } else {
        cfgSheet.clear();
      }
      khoiTaoBangNoiDungWeb(cfgSheet);

      var labelsMap = {
        // 🌊 1. BANNER ĐẦU TRANG
        heroTag: "🌊 1. Banner - Huy hiệu nhỏ đầu trang (Tagline)",
        heroMainTitle: "🌊 1. Banner - Tiêu đề lớn dòng 1",
        heroSubTitle: "🌊 1. Banner - Tiêu đề vàng dòng 2",
        heroDesc: "🌊 1. Banner - Đoạn mô tả giới thiệu",
        heroBgImg: "🌊 1. Banner - Ảnh nền biển (Link/Ảnh)",
        heroProductImg: "🌊 1. Banner - Ảnh chai mắm và chén mắm tách nền",
        heroCta1: "🌊 1. Banner - Chữ nút đặt mua chính",
        heroCta2: "🌊 1. Banner - Chữ nút khám phá phụ",

        // 🏷️ 2. HEADER & MENU
        headerLogo: "🏷️ 2. Header - Ảnh Logo (Link/Ảnh)",
        headerBrandName: "🏷️ 2. Header - Tên thương hiệu trên thanh menu",
        headerBrandSlogan: "🏷️ 2. Header - Slogan dưới Logo",
        headerCartText: "🏷️ 2. Header - Chữ nút giỏ hàng",
        headerNav1: "🏷️ 2. Header - Menu 1 (Câu chuyện)",
        headerNav2: "🏷️ 2. Header - Menu 2 (Quy trình)",
        headerNav3: "🏷️ 2. Header - Menu 3 (Bộ sưu tập)",
        headerNav4: "🏷️ 2. Header - Menu 4 (Sản phẩm)",
        headerNav5: "🏷️ 2. Header - Menu 5 (Mua sỉ)",
        headerNav6: "🏷️ 2. Header - Menu 6 (Ẩm thực)",
        headerNav7: "🏷️ 2. Header - Menu 7 (Đánh giá)",
        headerNav8: "🏷️ 2. Header - Menu 8 (Hỏi đáp)",

        // 📞 3. THƯƠNG HIỆU & LIÊN HỆ
        brandName: "📞 3. Thương Hiệu - Tên thương hiệu chung",
        brandSlogan: "📞 3. Thương Hiệu - Dòng chữ phụ chung",
        brandPhone: "📞 3. Thương Hiệu - Số Hotline & Zalo",
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

    // 0.5 Lưu & Cập nhật toàn bộ bảng Đánh Giá (Tab "DanhGia") - Chỉ Admin
    if (action === "save_reviews" && Array.isArray(data.reviews)) {
      var authRev = requireAdminSession_(data);
      if (!authRev.ok) return jsonError(authRev.message);
      var revSheet = ss.getSheetByName("DanhGia");
      if (!revSheet) {
        revSheet = ss.insertSheet("DanhGia");
      } else {
        revSheet.clear();
      }
      khoiTaoBangDanhGia(revSheet);

      var revList = data.reviews || [];
      for (var rIdx = 0; rIdx < revList.length; rIdx++) {
        var r = revList[rIdx];
        var targetRowRev = 3 + rIdx;
        var sttRev = rIdx + 1;
        var rowRev = [
          sttRev,
          r.date || nowStr,
          r.id || ("REV-" + (rIdx + 1)),
          r.name || "Khách mua online",
          "'" + (r.phone || ""),
          r.location || "Toàn quốc",
          r.product || "Nước mắm Ba Cô",
          Number(r.rating) || 5,
          Array.isArray(r.tags) ? r.tags.join(", ") : (r.tags || ""),
          r.comment || "",
          r.status || "approved"
        ];
        revSheet.getRange(targetRowRev, 1, 1, rowRev.length).setValues([rowRev]);
        dinhDangDongDanhGia(revSheet, targetRowRev);
      }
      return jsonSuccess({ saved: "DanhGia", count: revList.length });
    }

    // ========================================================
    // NHÁNH 1: CÁC LỆNH ĐỒNG BỘ ĐƠN HÀNG & KHÁCH SỈ TỪ ADMIN
    // ========================================================

    // ========================================================
    // NHÁNH SEPAY: NHẬN WEBHOOK TỰ ĐỘNG (BẮT BUỘC WEBHOOK_SECRET HỢP LỆ)
    // ========================================================
    if (action === "sepay_webhook") {
      var secWh = getOrCreateSecurityProps_();
      var providedSecret = String(data.webhookSecret || "");
      if (!providedSecret || !constantTimeEqual_(providedSecret, secWh.WEBHOOK_SECRET)) {
        return jsonError("Unauthorized webhook");
      }

      var rawContent = String(data.content || data.description || "");
      var rawCode = String(data.orderCode || data.code || "");
      var matchedCode = "";

      var m = (rawCode + " " + rawContent).match(/BC\d{4,9}/i);
      if (m) matchedCode = chuanHoa(m[0]);
      if (!matchedCode && rawCode) matchedCode = chuanHoa(rawCode);

      var paidAmount = Number(data.amount || data.transferAmount || 0);
      if (!matchedCode || paidAmount <= 0) {
        return jsonError("Thiếu mã đơn hoặc số tiền giao dịch không hợp lệ.");
      }

      // Kiểm tra đơn hàng trong Tab 1 trước để đối chiếu số tiền nếu đơn đã tồn tại
      var sheet = ss.getSheets()[0];
      var lastRow = sheet.getLastRow();
      var rowUpdated = -1;
      var matchedOrderExpected = 0;
      if (lastRow >= 3) {
        var codes = sheet.getRange("C3:C" + lastRow).getValues();
        for (var i = 0; i < codes.length; i++) {
          if (chuanHoa(codes[i][0]) === matchedCode) {
            rowUpdated = 3 + i;
            matchedOrderExpected = Number(sheet.getRange(rowUpdated, 9).getValue() || 0);
            break;
          }
        }
      }

      var isUnderpaid = (rowUpdated !== -1 && matchedOrderExpected > 0 && paidAmount < matchedOrderExpected);

      // Chỉ lưu PAID_ nếu không bị thiếu tiền
      if (!isUnderpaid) {
        try {
          var props = PropertiesService.getScriptProperties();
          props.setProperty("PAID_" + matchedCode, JSON.stringify({
            paid: true,
            amount: paidAmount,
            time: nowStr,
            gateway: String(data.gateway || "VietinBank").slice(0, 50),
            referenceCode: String(data.referenceCode || "").slice(0, 80)
          }));
        } catch(pErr) {}
      }

      if (rowUpdated !== -1) {
        var cell = sheet.getRange(rowUpdated, 12);
        var newStatus = isUnderpaid ? ("Thanh toán thiếu (" + paidAmount.toLocaleString("vi-VN") + "đ)") : "Đã nhận tiền (SePay QR)";
        cell.setValue(newStatus);
        dinhDangTrangThaiDonHang(cell, newStatus);

        if (!isUnderpaid) {
          try {
            sendOrderEmail({
              orderCode: sheet.getRange(rowUpdated, 3).getValue(),
              name: sheet.getRange(rowUpdated, 4).getValue(),
              phone: sheet.getRange(rowUpdated, 5).getValue(),
              address: sheet.getRange(rowUpdated, 6).getValue(),
              product: sheet.getRange(rowUpdated, 7).getValue(),
              quantity: sheet.getRange(rowUpdated, 8).getValue(),
              totalAmount: matchedOrderExpected || paidAmount,
              paymentMethod: "Chuyển khoản VietQR (SePay)",
              status: newStatus
            }, sheet.getRange(rowUpdated, 3).getValue(), nowStr);
          } catch(eMail) {}
        }
      }

      return jsonSuccess({
        success: !isUnderpaid,
        underpaid: isUnderpaid,
        orderCode: matchedCode,
        amount: paidAmount,
        expectedAmount: matchedOrderExpected,
        rowUpdated: rowUpdated
      });
    }

    // 1.1 Cập nhật trạng thái đơn bán lẻ (Tab 1) - Chỉ Admin
    if (action === "update_order_status") {
      var authUpdOrd = requireAdminSession_(data);
      if (!authUpdOrd.ok) return jsonError(authUpdOrd.message);
      var sheet = ss.getSheets()[0];
      var cleanCode = chuanHoa(data.orderCode);

      if (String(data.status || "").toLowerCase().indexOf("nhận") !== -1) {
        try {
          var props = PropertiesService.getScriptProperties();
          props.setProperty("PAID_" + cleanCode, JSON.stringify({
            paid: true,
            amount: Number(data.amount || 0),
            time: nowStr,
            verifiedBy: authUpdOrd.username
          }));
        } catch(pErr) {}
      }

      var lastRow = sheet.getLastRow();
      if (lastRow >= 3) {
        var codes = sheet.getRange("C3:C" + lastRow).getValues();
        for (var i = 0; i < codes.length; i++) {
          if (chuanHoa(codes[i][0]) === cleanCode) {
            var targetRow = 3 + i;
            var cell = sheet.getRange(targetRow, 12);
            var prevStatus = String(cell.getValue() || "");
            var nextStatus = sanitizeSheetCell_(String(data.status || "").slice(0, 100));
            var isPrevCancel = (prevStatus.indexOf("Hủy") !== -1 || prevStatus.indexOf("hủy") !== -1 || prevStatus.indexOf("Hoàn hàng") !== -1);
            var isNextCancel = (nextStatus.indexOf("Hủy") !== -1 || nextStatus.indexOf("hủy") !== -1 || nextStatus.indexOf("Hoàn hàng") !== -1);
            cell.setValue(nextStatus);
            dinhDangTrangThaiDonHang(cell, nextStatus);
            if (!isPrevCancel && isNextCancel) {
              var orderProd = String(sheet.getRange(targetRow, 7).getValue() || "");
              var orderQty = Number(sheet.getRange(targetRow, 8).getValue()) || 1;
              adjustProductStock_(ss, orderProd, orderQty, 1);
            } else if (isPrevCancel && !isNextCancel) {
              var orderProdR = String(sheet.getRange(targetRow, 7).getValue() || "");
              var orderQtyR = Number(sheet.getRange(targetRow, 8).getValue()) || 1;
              adjustProductStock_(ss, orderProdR, orderQtyR, -1);
            }
            return jsonSuccess({ row: targetRow, status: nextStatus });
          }
        }
      }
      return jsonSuccess({ status: data.status, msg: "Đã cập nhật trạng thái: " + cleanCode });
    }

    // 1.2 Xóa đơn hàng bán lẻ (Tab 1) - Chỉ Admin
    if (action === "delete_order") {
      var authDelOrd = requireAdminSession_(data);
      if (!authDelOrd.ok) return jsonError(authDelOrd.message);
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

    // 1.3 Dọn sạch toàn bộ đơn bán lẻ (Tab 1) - Chỉ Admin
    if (action === "clear_all_orders") {
      var authClrOrd = requireAdminSession_(data);
      if (!authClrOrd.ok) return jsonError(authClrOrd.message);
      var sheet = ss.getSheets()[0];
      var lastRow = sheet.getLastRow();
      if (lastRow >= 3) {
        sheet.deleteRows(3, lastRow - 2);
      }
      return jsonSuccess({ cleared: true });
    }

    // 1.4 Cập nhật trạng thái khách sỉ & đại lý (Tab 2) - Chỉ Admin
    if (action === "update_wholesale_status") {
      var authUpdWs = requireAdminSession_(data);
      if (!authUpdWs.ok) return jsonError(authUpdWs.message);
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
              var safeWsStatus = sanitizeSheetCell_(String(data.status || "").slice(0, 100));
              cell.setValue(safeWsStatus);
              dinhDangTrangThaiDaiLy(cell, safeWsStatus);
              return jsonSuccess({ row: targetRow, status: safeWsStatus });
            }
          }
        }
      }
      return jsonError("Không tìm thấy mã đại lý: " + data.leadCode);
    }

    // 1.5 Xóa khách sỉ & đại lý (Tab 2) - Chỉ Admin
    if (action === "delete_wholesale") {
      var authDelWs = requireAdminSession_(data);
      if (!authDelWs.ok) return jsonError(authDelWs.message);
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

    // 1.6 Dọn sạch toàn bộ khách sỉ & đại lý (Tab 2) - Chỉ Admin
    if (action === "clear_all_wholesale") {
      var authClrWs = requireAdminSession_(data);
      if (!authClrWs.ok) return jsonError(authClrWs.message);
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
      var leadCode = "#DL" + Math.floor(Math.random() * 899999 + 100000);
      var safeNameWs = sanitizeSheetCell_(String(data.name || "Chưa có tên").trim().slice(0, 120));
      var safePhoneWs = String(data.phone || "").replace(/[^\d+\-\s()]/g, "").slice(0, 20);
      var safeAreaWs = sanitizeSheetCell_(String(data.area || "Toàn quốc").trim().slice(0, 120));
      var safeBizWs = sanitizeSheetCell_(String(data.businessModel || "Đại lý phân phối").trim().slice(0, 120));
      var safeNoteWs = sanitizeSheetCell_(String(data.note || "").trim().slice(0, 500));

      var rowData = [
        stt,
        nowStr,
        leadCode,
        safeNameWs,
        "'" + safePhoneWs,
        safeAreaWs,
        safeBizWs,
        safeNoteWs,
        "Chờ gọi tư vấn"
      ];

      wholesaleSheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
      dinhDangDongKhachSi(wholesaleSheet, targetRow);

      var cleanWsData = {
        name: safeNameWs,
        phone: safePhoneWs,
        area: safeAreaWs,
        businessModel: safeBizWs,
        note: safeNoteWs
      };
      sendWholesaleEmail(cleanWsData, leadCode, nowStr);
      sendTelegramWholesale(cleanWsData, leadCode, nowStr);
      sendServerWebPush(cleanWsData, leadCode, "wholesale");

      return jsonSuccess({ type: "wholesale", leadCode: leadCode, row: targetRow });
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
      var clampedRating = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5)));
      var safeRevName = sanitizeSheetCell_(String(r.name || "Khách mua online").trim().slice(0, 100));
      var safeRevPhone = String(r.phone || "").replace(/[^\d+\-\s()]/g, "").slice(0, 20);
      var safeRevLoc = sanitizeSheetCell_(String(r.location || "Toàn quốc").trim().slice(0, 100));
      var safeRevProd = sanitizeSheetCell_(String(r.product || "Nước mắm Ba Cô").trim().slice(0, 160));
      var safeRevTags = Array.isArray(r.tags) ? r.tags.slice(0, 6).map(function(t) { return sanitizeSheetCell_(String(t).slice(0, 60)); }).join(", ") : "";
      var safeRevComment = sanitizeSheetCell_(String(r.comment || "").trim().slice(0, 800));

      var rowRev = [
        sttRev,
        nowStr,
        "REV-" + Date.now().toString().slice(-6),
        safeRevName,
        "'" + safeRevPhone,
        safeRevLoc,
        safeRevProd,
        clampedRating,
        safeRevTags,
        safeRevComment,
        "approved"
      ];

      revSheet.getRange(targetRowRev, 1, 1, rowRev.length).setValues([rowRev]);
      dinhDangDongDanhGia(revSheet, targetRowRev);

      sendReviewEmail({
        name: safeRevName,
        phone: safeRevPhone,
        location: safeRevLoc,
        product: safeRevProd,
        rating: clampedRating,
        tags: Array.isArray(r.tags) ? r.tags.slice(0, 6) : [],
        comment: safeRevComment
      }, nowStr);

      return jsonSuccess({ type: "review", row: targetRowRev });
    }

    // 2.3 Đơn hàng bán lẻ (Tab 1) - TÍNH GIÁ & XÁC MINH TRẠNG THÁI THANH TOÁN TẠI BACKEND
    var isRealOrder = (data.orderCode && String(data.orderCode).replace("#", "").toUpperCase().indexOf("BC") === 0) ||
                      (data.product && data.phone) ||
                      (Array.isArray(data.items) && data.items.length > 0 && data.phone);

    if (isRealOrder) {
      var cleanPhoneOrder = String(data.phone || "").replace(/\D/g, "");
      if (cleanPhoneOrder.length < 9 || cleanPhoneOrder.length > 13) {
        return jsonError("Số điện thoại đặt hàng không hợp lệ.");
      }

      // Tính toán toàn bộ giá trị đơn hàng từ bảng SanPham & Voucher trên Server (chống sửa giá từ client)
      var pricing = calculateOrderPricingServer_(ss, data);
      if (!pricing.ok) {
        return jsonError(pricing.message || "Không xác định được sản phẩm hoặc giá trị đơn hàng.");
      }

      var sheet = ss.getSheets()[0];
      var cleanOrderCode = chuanHoa(data.orderCode);
      if (!cleanOrderCode || cleanOrderCode.indexOf("BC") !== 0) {
        cleanOrderCode = "BC" + Math.floor(Math.random() * 899999 + 100000);
      }

      // Chống ghi trùng mã đơn hàng
      var existingLastRow = sheet.getLastRow();
      if (existingLastRow >= 3) {
        var existingCodes = sheet.getRange("C3:C" + existingLastRow).getValues();
        for (var ec = 0; ec < existingCodes.length; ec++) {
          if (chuanHoa(existingCodes[ec][0]) === cleanOrderCode) {
            return jsonSuccess({
              type: "retail",
              duplicate: true,
              orderCode: cleanOrderCode,
              totalAmount: pricing.totalAmount
            });
          }
        }
      }

      var rawPayMethod = String(data.paymentMethod || "COD (Thanh toán tiền mặt khi nhận hàng)").slice(0, 100);
      var payLower = rawPayMethod.toLowerCase();
      var isQrPay = (payLower.indexOf("vietqr") !== -1 || payLower.indexOf("chuyển khoản") !== -1 || payLower.indexOf("sepay") !== -1 || payLower.indexOf("qr") !== -1);

      // Ngăn chặn giả mạo trạng thái thanh toán: chỉ xác nhận Đã nhận tiền khi ScriptProperties có giao dịch SePay hợp lệ >= tổng đơn
      var enforcedStatus = isQrPay ? "Chờ thanh toán QR" : "Chờ xác nhận";
      if (isQrPay) {
        try {
          var propsOrder = PropertiesService.getScriptProperties();
          var paidRaw = propsOrder.getProperty("PAID_" + cleanOrderCode);
          if (paidRaw) {
            var paidObj = JSON.parse(paidRaw);
            if (paidObj && paidObj.paid === true && Number(paidObj.amount || 0) >= pricing.totalAmount) {
              enforcedStatus = "Đã nhận tiền (SePay QR)";
            } else if (paidObj && paidObj.paid === true && Number(paidObj.amount || 0) > 0) {
              enforcedStatus = "Thanh toán thiếu (" + Number(paidObj.amount).toLocaleString("vi-VN") + "đ)";
            }
          }
        } catch (pCheckErr) {}
      }

      var targetRow = timDongTrong(sheet);
      var safeNameOrd = sanitizeSheetCell_(String(data.name || "").trim().slice(0, 120));
      var safeAddrOrd = sanitizeSheetCell_(String(data.address || "").trim().slice(0, 300));
      var safeProdOrd = sanitizeSheetCell_(pricing.productSummary.slice(0, 400));
      var safePayOrd = sanitizeSheetCell_(rawPayMethod);
      var voucherTag = pricing.voucherCode ? (" [Mã: " + pricing.voucherCode + " -" + pricing.discountAmount.toLocaleString("vi-VN") + "đ]") : "";
      var safeNoteOrd = sanitizeSheetCell_((String(data.note || "").replace(/\s*\[Mã:[^\]]*\]/g, "").trim() + voucherTag).slice(0, 500));

      var rowData = [
        nowStr,
        cleanOrderCode,
        safeNameOrd,
        "'" + cleanPhoneOrder,
        safeAddrOrd,
        safeProdOrd,
        pricing.totalQty,
        pricing.totalAmount,
        safePayOrd,
        safeNoteOrd,
        enforcedStatus
      ];

      sheet.getRange(targetRow, 2, 1, rowData.length).setValues([rowData]);
      dinhDangDongDonHang(sheet, targetRow);
      adjustProductStock_(ss, pricing.productSummary, pricing.totalQty, -1);

      if (enforcedStatus !== "Chờ thanh toán QR") {
        var emailOrderPayload = {
          orderCode: cleanOrderCode,
          name: safeNameOrd,
          phone: cleanPhoneOrder,
          address: safeAddrOrd,
          product: safeProdOrd,
          quantity: pricing.totalQty,
          totalAmount: pricing.totalAmount,
          paymentMethod: safePayOrd,
          note: safeNoteOrd,
          status: enforcedStatus
        };
        sendOrderEmail(emailOrderPayload, cleanOrderCode, nowStr);
        sendTelegramNotification(emailOrderPayload, cleanOrderCode, nowStr);
        sendServerWebPush(emailOrderPayload, cleanOrderCode, "orders");
      }

      return jsonSuccess({
        type: "retail",
        row: targetRow,
        orderCode: cleanOrderCode,
        subtotal: pricing.subtotal,
        discountAmount: pricing.discountAmount,
        shippingFee: pricing.shippingFee,
        totalAmount: pricing.totalAmount,
        orderStatus: enforcedStatus
      });
    }

    if (action === "save_vouchers" && Array.isArray(data.vouchers)) {
      var authVouch = requireAdminSession_(data);
      if (!authVouch.ok) return jsonError(authVouch.message);
      var vSheet = ss.getSheetByName("Voucher");
      if (!vSheet) {
        vSheet = ss.insertSheet("Voucher");
      } else {
        vSheet.clear();
      }
      khoiTaoBangVoucher(vSheet);
      var vItems = data.vouchers || [];
      for (var vIdx = 0; vIdx < vItems.length; vIdx++) {
        var v = vItems[vIdx];
        var vRow = 3 + vIdx;
        var rowV = [
          sanitizeSheetCell_(String(v.code || "").trim().toUpperCase()),
          String(v.type || "fixed"),
          Number(v.value) || 0,
          Number(v.minOrder) || 0,
          Number(v.maxDiscount) || 0,
          v.active === false ? "Tắt" : "Đang bật",
          sanitizeSheetCell_(String(v.note || ""))
        ];
        vSheet.getRange(vRow, 1, 1, rowV.length).setValues([rowV]);
        dinhDangDongVoucher(vSheet, vRow, v.active !== false);
      }
      try { CacheService.getScriptCache().remove("baco_vouchers_v1"); } catch (ce) {}
      return jsonSuccess({ saved: "Voucher", count: vItems.length });
    }

    return jsonSuccess({ msg: "Action processed without order creation", action: action });

  } catch (error) {
    return jsonError(error.toString());
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (le) {}
    }
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
        '<strong style="font-size: 16px; color: #0f172a;">#' + escapeHtmlGas_(code) + '</strong>' +
        '<div style="font-size: 12px; color: #64748b; margin-top: 4px;">Thời gian: ' + escapeHtmlGas_(timeStr) + '</div>' +
      '</div>' +
      '<table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">' +
        '<tr><td style="padding: 8px 0; color: #64748b; width: 130px;">Khách Hàng:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a;">' + escapeHtmlGas_(d.name || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Số Điện Thoại:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; font-size: 16px;">' + escapeHtmlGas_(d.phone || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Địa Chỉ Giao:</td><td style="padding: 8px 0; color: #0f172a;">' + escapeHtmlGas_(d.address || "") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Sản Phẩm Đặt:</td><td style="padding: 8px 0; font-weight: bold; color: #047857;">' + escapeHtmlGas_(d.product || "") + ' (SL: ' + escapeHtmlGas_(d.quantity || 1) + ')</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Tổng Tiền:</td><td style="padding: 8px 0; font-weight: bold; font-size: 18px; color: #b45309;">' + escapeHtmlGas_(totalFormatted) + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Thanh Toán:</td><td style="padding: 8px 0; color: #0f172a;">' + escapeHtmlGas_(d.paymentMethod || "COD") + '</td></tr>' +
        '<tr><td style="padding: 8px 0; color: #64748b;">Ghi Chú:</td><td style="padding: 8px 0; color: #64748b; font-style: italic;">' + escapeHtmlGas_(d.note || "Không có") + '</td></tr>' +
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
  sheet.getRange("A1:J1").merge()
       .setValue("DANH SÁCH SẢN PHẨM KINH DOANH - NƯỚC MẮM BA CÔ KHÁNH HÒA")
       .setBackground("#b45309").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13).setFontFamily("Roboto")
       .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  var headers = ["Mã SP", "Tên Sản Phẩm", "Giá Bán (VNĐ)", "Quy Cách", "Dòng Sản Phẩm", "Huy Hiệu", "Trạng Thái Kho", "Mô Tả Chi Tiết", "Hình Ảnh (Link / Dữ Liệu)", "Tồn Kho (SL)"];
  sheet.getRange("A2:J2").setValues([headers])
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
  sheet.setColumnWidth(10, 100);
}

function dinhDangDongSanPham(sheet, row, inStock) {
  var range = sheet.getRange(row, 1, 1, 10);
  range.setFontFamily("Roboto").setFontSize(10).setVerticalAlignment("middle");
  range.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(row, 38);

  var stockBg = inStock ? "#dcfce7" : "#fee2e2";
  var stockColor = inStock ? "#15803d" : "#b91c1c";

  range.setBackgrounds([["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#f0fdfa", "#fffbeb", stockBg, "#ffffff", "#f8fafc", "#ffffff"]]);
  range.setFontColors([["#64748b", "#0f172a", "#b45309", "#334155", "#0f766e", "#b45309", stockColor, "#475569", "#64748b", "#0f172a"]]);
  range.setHorizontalAlignments([["center", "left", "right", "center", "center", "center", "center", "left", "left", "center"]]);
  range.setFontWeights([["bold", "bold", "bold", "normal", "bold", "bold", "bold", "normal", "normal", "bold"]]);
  sheet.getRange(row, 3).setNumberFormat("#,##0 \"đ\"");
  sheet.getRange(row, 10).setNumberFormat("#,##0");
}

function adjustProductStock_(ss, productText, qtyFallback, direction) {
  try {
    var prodSheet = ss.getSheetByName("SanPham");
    if (!prodSheet) return;
    var lastRow = prodSheet.getLastRow();
    if (lastRow < 3) return;
    var names = prodSheet.getRange("B3:B" + lastRow).getValues();
    var stocks = prodSheet.getRange("J3:J" + lastRow).getValues();
    var statuses = prodSheet.getRange("G3:G" + lastRow).getValues();

    // Tách danh sách "Tên SP (x2), Tên SP 2 (x1)" hoặc 1 tên SP đơn lẻ
    var parts = String(productText || "").split(",");
    var items = [];
    for (var i = 0; i < parts.length; i++) {
      var raw = String(parts[i] || "").trim();
      if (!raw) continue;
      var m = raw.match(/^(.*?)\s*\(x(\d+)\)\s*$/i);
      if (m) {
        items.push({ name: m[1].trim().toLowerCase(), qty: Math.max(1, parseInt(m[2], 10) || 1) });
      } else {
        items.push({ name: raw.toLowerCase(), qty: Math.max(1, Number(qtyFallback) || 1) });
      }
    }
    if (items.length === 0) return;

    for (var k = 0; k < items.length; k++) {
      var targetName = items[k].name;
      for (var r = 0; r < names.length; r++) {
        var sheetName = String(names[r][0] || "").trim().toLowerCase();
        if (!sheetName) continue;
        if (sheetName === targetName || sheetName.indexOf(targetName) !== -1 || targetName.indexOf(sheetName) !== -1) {
          var rawStock = stocks[r][0];
          var curStock = (rawStock === "" || rawStock === null || rawStock === undefined) ? 100 : (Number(rawStock) || 0);
          var newStock = Math.max(0, curStock + (direction * items[k].qty));
          var rowNum = 3 + r;
          prodSheet.getRange(rowNum, 10).setValue(newStock);
          var newAvail = newStock > 0;
          prodSheet.getRange(rowNum, 7).setValue(newAvail ? "Còn hàng" : "Hết hàng");
          dinhDangDongSanPham(prodSheet, rowNum, newAvail);
          stocks[r][0] = newStock;
          statuses[r][0] = newAvail ? "Còn hàng" : "Hết hàng";
          break;
        }
      }
    }
  } catch (e) {}
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

// ========================================================
// HỆ THỐNG BẢO MẬT, MÃ HÓA PBKDF2 & QUẢN LÝ PHIÊN (SESSION LIFECYCLE)
// ========================================================

function sanitizeSheetCell_(val) {
  var s = String(val === null || val === undefined ? "" : val);
  if (s && /^[=+\-@\t\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}

function escapeHtmlGas_(str) {
  return String(str === null || str === undefined ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bytesToHex_(bytes) {
  var hex = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    hex.push((b < 16 ? "0" : "") + b.toString(16));
  }
  return hex.join("");
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ""), Utilities.Charset.UTF_8));
}

function constantTimeEqual_(a, b) {
  var sa = String(a || "");
  var sb = String(b || "");
  var diff = sa.length ^ sb.length;
  var len = Math.max(sa.length, sb.length);
  for (var i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function getOrCreateSecurityProps_() {
  var props = PropertiesService.getScriptProperties();
  var changed = {};
  var pepper = props.getProperty("AUTH_PEPPER");
  if (!pepper) {
    pepper = sha256Hex_(Utilities.getUuid() + ":" + Math.random() + ":pepper");
    changed.AUTH_PEPPER = pepper;
  }
  var signKey = props.getProperty("SESSION_SIGN_KEY");
  if (!signKey) {
    signKey = sha256Hex_(Utilities.getUuid() + ":" + Date.now() + ":session");
    changed.SESSION_SIGN_KEY = signKey;
  }
  var webhookSecret = props.getProperty("WEBHOOK_SECRET");
  if (!webhookSecret) {
    webhookSecret = sha256Hex_(Utilities.getUuid() + ":" + Date.now() + ":webhook");
    changed.WEBHOOK_SECRET = webhookSecret;
  }
  var adminApiSecret = props.getProperty("ADMIN_API_SECRET");
  if (!adminApiSecret) {
    adminApiSecret = sha256Hex_(Utilities.getUuid() + ":" + Date.now() + ":adminapi");
    changed.ADMIN_API_SECRET = adminApiSecret;
  }
  if (Object.keys(changed).length > 0) {
    props.setProperties(changed);
  }
  return {
    AUTH_PEPPER: pepper,
    SESSION_SIGN_KEY: signKey,
    WEBHOOK_SECRET: webhookSecret,
    ADMIN_API_SECRET: adminApiSecret,
    AUTH_SPREADSHEET_ID: props.getProperty("AUTH_SPREADSHEET_ID") || ""
  };
}

function hmacSignBytes_(payloadBytesOrStr, keyBytesOrStr) {
  return Utilities.computeHmacSha256Signature(payloadBytesOrStr, keyBytesOrStr);
}

function hmacSignHex_(payload, secret) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(String(payload || ""), String(secret || "")));
}

// PBKDF2-HMAC-SHA256 (RFC 2898) với 10.000 vòng lặp + Salt ngẫu nhiên + Pepper
function pbkdf2HmacSha256_(password, salt, iterations, pepper) {
  var iters = Math.max(1000, Math.min(20000, Number(iterations) || 10000));
  var pwdKey = String(pepper || "") + ":" + String(password || "");
  var blockInput = String(salt || "") + "\x00\x00\x00\x01";
  var u = Utilities.computeHmacSha256Signature(blockInput, pwdKey);
  var t = u.slice();
  for (var i = 1; i < iters; i++) {
    u = Utilities.computeHmacSha256Signature(u, pwdKey);
    for (var j = 0; j < t.length; j++) {
      t[j] = t[j] ^ u[j];
    }
  }
  return bytesToHex_(t);
}

function hashPasswordWithSalt_(password, salt, pepper) {
  var iterations = 10000;
  var dk = pbkdf2HmacSha256_(password, salt, iterations, pepper);
  return "baco$pbkdf2$" + iterations + "$" + salt + "$" + dk;
}

function hashLegacySha256_(password, salt, pepper) {
  var acc = sha256Hex_(pepper + ":" + salt + ":" + String(password || ""));
  for (var r = 0; r < 499; r++) {
    acc = sha256Hex_(acc + ":" + salt + ":" + pepper);
  }
  return "baco$sha256$" + salt + "$" + acc;
}

function verifyPasswordHash_(password, storedValue, pepper) {
  var val = String(storedValue || "").trim();
  if (val.indexOf("baco$pbkdf2$") === 0) {
    var parts = val.split("$");
    if (parts.length !== 5) return false;
    var iters = parseInt(parts[2], 10);
    var salt = parts[3];
    var expectedDk = pbkdf2HmacSha256_(password, salt, iters, pepper);
    return constantTimeEqual_(expectedDk, parts[4]);
  }
  if (val.indexOf("baco$sha256$") === 0) {
    var oldParts = val.split("$");
    if (oldParts.length !== 4) return false;
    var oldSalt = oldParts[2];
    var expectedOld = hashLegacySha256_(password, oldSalt, pepper);
    return constantTimeEqual_(expectedOld, val);
  }
  return false;
}

function getUserTokenVersion_(username) {
  try {
    var props = PropertiesService.getScriptProperties();
    var v = parseInt(props.getProperty("TV_" + String(username || "admin").toLowerCase()) || "1", 10);
    return isNaN(v) || v < 1 ? 1 : v;
  } catch (e) {
    return 1;
  }
}

function bumpUserTokenVersion_(username) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = "TV_" + String(username || "admin").toLowerCase();
    var next = getUserTokenVersion_(username) + 1;
    props.setProperty(key, String(next));
    return next;
  } catch (e) {
    return 1;
  }
}

function revokeSessionJti_(jti, expMs) {
  if (!jti) return;
  var ttlSec = Math.max(60, Math.min(21600, Math.ceil(((Number(expMs) || Date.now()) - Date.now()) / 1000) + 60));
  try {
    var cache = CacheService.getScriptCache();
    if (cache) cache.put("REV_" + jti, "1", ttlSec);
  } catch (e) {}
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("REV_" + jti, String(expMs || (Date.now() + 7200000)));
  } catch (e2) {}
}

function isSessionRevoked_(jti) {
  if (!jti) return true;
  try {
    var cache = CacheService.getScriptCache();
    if (cache && cache.get("REV_" + jti)) return true;
  } catch (e) {}
  try {
    var props = PropertiesService.getScriptProperties();
    var val = props.getProperty("REV_" + jti);
    if (val) {
      if (Number(val) < Date.now()) {
        props.deleteProperty("REV_" + jti);
        return false;
      }
      return true;
    }
  } catch (e2) {}
  return false;
}

// Session Token ngắn hạn (2 giờ), có jti & tokenVersion để hỗ trợ thu hồi & làm mới
function createSignedSession_(username, role, signKey) {
  var expMs = Date.now() + 2 * 3600 * 1000;
  var jti = sha256Hex_(Utilities.getUuid() + ":" + Date.now()).slice(0, 16);
  var ver = getUserTokenVersion_(username);
  var uB64 = Utilities.base64EncodeWebSafe(String(username || "admin"), Utilities.Charset.UTF_8).replace(/=+$/, "");
  var rB64 = Utilities.base64EncodeWebSafe(String(role || "Quản trị viên"), Utilities.Charset.UTF_8).replace(/=+$/, "");
  var payload = "v2." + expMs + "." + jti + "." + ver + "." + uB64 + "." + rB64;
  var sig = hmacSignHex_(payload, signKey);
  return { token: payload + "." + sig, expiresAt: expMs };
}

function verifySignedSession_(token, signKey) {
  var parts = String(token || "").split(".");
  if (parts.length !== 7 || parts[0] !== "v2") return null;
  var expMs = Number(parts[1]);
  if (!expMs || expMs < Date.now()) return null;
  var jti = String(parts[2] || "");
  var ver = parseInt(parts[3], 10);
  var payload = parts.slice(0, 6).join(".");
  var expected = hmacSignHex_(payload, signKey);
  if (!constantTimeEqual_(expected, parts[6])) return null;
  if (isSessionRevoked_(jti)) return null;
  try {
    var uname = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[4])).getDataAsString("UTF-8");
    var urole = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[5])).getDataAsString("UTF-8");
    if (ver !== getUserTokenVersion_(uname)) return null;
    return { username: uname, role: urole, expiresAt: expMs, jti: jti, ver: ver };
  } catch (e) {
    return null;
  }
}

function requireAdminSession_(data) {
  var token = String((data && (data.sessionToken || data.token)) || "").trim();
  if (!token) return { ok: false, message: "Unauthorized: Thiếu phiên đăng nhập quản trị." };
  var sec = getOrCreateSecurityProps_();
  var sess = verifySignedSession_(token, sec.SESSION_SIGN_KEY);
  if (!sess) return { ok: false, message: "Unauthorized: Phiên đăng nhập đã hết hạn hoặc bị thu hồi." };

  var authCtx = getAuthSpreadsheet_();
  if (!authCtx.ss) return { ok: false, message: "Auth sheet unavailable" };
  var userSheet = authCtx.ss.getSheetByName("QuanTriVien");
  if (!userSheet || userSheet.getLastRow() < 3) return { ok: false, message: "Unauthorized" };

  var targetUser = String(sess.username || "").trim().toLowerCase();
  var rows = userSheet.getRange(3, 1, userSheet.getLastRow() - 2, 4).getValues();
  for (var i = 0; i < rows.length; i++) {
    var rowUser = String(rows[i][0] || "").trim().toLowerCase();
    if (rowUser !== targetUser) continue;
    var rowStatus = String(rows[i][2] || "").trim().toLowerCase();
    if (rowStatus === "hoạt động" || rowStatus === "active") {
      return { ok: true, username: rowUser, role: String(rows[i][1] || sess.role), sess: sess };
    }
    return { ok: false, message: "Tài khoản quản trị đã bị khóa." };
  }
  return { ok: false, message: "Unauthorized: Không tìm thấy tài khoản." };
}

function getAuthSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var privateId = props.getProperty("AUTH_SPREADSHEET_ID");
  if (privateId) {
    try {
      return { ss: SpreadsheetApp.openById(privateId), isPrivate: true };
    } catch (e) {
      Logger.log("Không mở được AUTH_SPREADSHEET_ID: " + e.toString());
    }
  }
  return { ss: layBangTinh(), isPrivate: false };
}

function ensureAdminSecuritySheets_(ss) {
  var userSheet = ss.getSheetByName("QuanTriVien");
  if (!userSheet) {
    userSheet = ss.insertSheet("QuanTriVien");
    userSheet.appendRow(["BẢNG TÀI KHOẢN QUẢN TRỊ BẢO MẬT — NƯỚC MẮM BA CÔ KHÁNH HÒA"]);
    userSheet.getRange("A1:G1").merge().setBackground("#0f172a").setFontColor("#fbbf24").setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center");
    userSheet.appendRow(["Tên đăng nhập", "Vai trò", "Trạng thái", "Mật khẩu (Mã hóa PBKDF2)", "Lần đăng nhập cuối", "IP đăng nhập cuối", "Ghi chú"]);
    userSheet.getRange("A2:G2").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
    userSheet.appendRow(["admin", "Chủ xưởng (Owner)", "Hoạt động", "", "", "", "Dùng menu 🔐 Bảo Mật Quản Trị -> Đặt mật khẩu"]);
    userSheet.setFrozenRows(2);
    userSheet.setColumnWidth(1, 150);
    userSheet.setColumnWidth(2, 180);
    userSheet.setColumnWidth(3, 120);
    userSheet.setColumnWidth(4, 340);
    userSheet.setColumnWidth(5, 170);
    userSheet.setColumnWidth(6, 150);
    userSheet.setColumnWidth(7, 260);
    var statusRule = SpreadsheetApp.newDataValidation().requireValueInList(["Hoạt động", "Khóa"], true).build();
    userSheet.getRange("C3:C50").setDataValidation(statusRule);
  }

  var logSheet = ss.getSheetByName("NhatKyDangNhap");
  if (!logSheet) {
    logSheet = ss.insertSheet("NhatKyDangNhap");
    logSheet.appendRow(["NHẬT KÝ ĐĂNG NHẬP QUẢN TRỊ (AUDIT LOG)"]);
    logSheet.getRange("A1:F1").merge().setBackground("#0f172a").setFontColor("#38bdf8").setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center");
    logSheet.appendRow(["Thời gian", "Tên đăng nhập", "Trạng thái", "Chi tiết", "Địa chỉ IP", "Thiết bị (User-Agent)"]);
    logSheet.getRange("A2:F2").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
    logSheet.setFrozenRows(2);
    logSheet.setColumnWidth(1, 165);
    logSheet.setColumnWidth(2, 140);
    logSheet.setColumnWidth(3, 130);
    logSheet.setColumnWidth(4, 240);
    logSheet.setColumnWidth(5, 140);
    logSheet.setColumnWidth(6, 320);
  }
  return { userSheet: userSheet, logSheet: logSheet };
}

function appendLoginAudit_(logSheet, timeStr, username, statusLabel, detail, ip, ua) {
  try {
    if (!logSheet) return;
    logSheet.appendRow([
      String(timeStr || new Date().toLocaleString("vi-VN")),
      sanitizeSheetCell_(String(username || "")),
      sanitizeSheetCell_(String(statusLabel || "")),
      sanitizeSheetCell_(String(detail || "")),
      sanitizeSheetCell_(String(ip || "")),
      sanitizeSheetCell_(String(ua || "").slice(0, 180))
    ]);
    var total = logSheet.getLastRow();
    if (total > 502) {
      logSheet.deleteRows(3, total - 502);
    }
  } catch (e) {}
}

function khoiTaoBaoMatQuanTri() {
  getOrCreateSecurityProps_();
  var authCtx = getAuthSpreadsheet_();
  if (!authCtx.ss) {
    Logger.log("Không tìm thấy bảng tính Google Sheet.");
    return;
  }
  ensureAdminSecuritySheets_(authCtx.ss);
  Logger.log("✅ Đã khởi tạo bảng QuanTriVien & NhatKyDangNhap thành công!");
}

function datMatKhauQuanTri(username, plainPassword, role) {
  var uname = String(username || "admin").trim().toLowerCase();
  var pw = String(plainPassword || "");
  if (!uname || pw.length < 8) {
    throw new Error("Tên đăng nhập không được trống và mật khẩu phải từ 8 ký tự trở lên.");
  }
  var sec = getOrCreateSecurityProps_();
  var authCtx = getAuthSpreadsheet_();
  if (!authCtx.ss) throw new Error("Không mở được Google Sheet.");
  var sheets = ensureAdminSecuritySheets_(authCtx.ss);
  var userSheet = sheets.userSheet;

  var salt = sha256Hex_(Utilities.getUuid() + ":" + Date.now()).slice(0, 24);
  var hashed = hashPasswordWithSalt_(pw, salt, sec.AUTH_PEPPER);
  bumpUserTokenVersion_(uname);

  var lastRow = userSheet.getLastRow();
  if (lastRow >= 3) {
    var rows = userSheet.getRange(3, 1, lastRow - 2, 7).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || "").trim().toLowerCase() === uname) {
        var r = 3 + i;
        if (role) userSheet.getRange(r, 2).setValue(role);
        userSheet.getRange(r, 3).setValue("Hoạt động");
        userSheet.getRange(r, 4).setValue(hashed);
        userSheet.getRange(r, 7).setValue("Cập nhật PBKDF2 lúc " + new Date().toLocaleString("vi-VN"));
        return true;
      }
    }
  }
  userSheet.appendRow([uname, role || "Quản trị viên", "Hoạt động", hashed, "", "", "Tạo mới PBKDF2 lúc " + new Date().toLocaleString("vi-VN")]);
  return true;
}

function maHoaTatCaMatKhauSheet() {
  var sec = getOrCreateSecurityProps_();
  var authCtx = getAuthSpreadsheet_();
  if (!authCtx.ss) return 0;
  var sheets = ensureAdminSecuritySheets_(authCtx.ss);
  var userSheet = sheets.userSheet;
  var lastRow = userSheet.getLastRow();
  if (lastRow < 3) return 0;
  var range = userSheet.getRange(3, 1, lastRow - 2, 7);
  var vals = range.getValues();
  var count = 0;
  for (var i = 0; i < vals.length; i++) {
    var rawPw = String(vals[i][3] || "").trim();
    if (rawPw && rawPw.indexOf("baco$pbkdf2$") !== 0 && rawPw.indexOf("baco$sha256$") !== 0) {
      var salt = sha256Hex_(Utilities.getUuid() + ":" + i + ":" + Date.now()).slice(0, 24);
      userSheet.getRange(3 + i, 4).setValue(hashPasswordWithSalt_(rawPw, salt, sec.AUTH_PEPPER));
      userSheet.getRange(3 + i, 7).setValue("Đã mã hóa PBKDF2 " + new Date().toLocaleString("vi-VN"));
      count++;
    }
  }
  return count;
}

function getBruteForceState_(username) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get("BF_" + String(username || "admin").slice(0, 48));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { fails: 0, lockUntil: 0 };
}

function saveBruteForceState_(username, state) {
  try {
    var cache = CacheService.getScriptCache();
    cache.put("BF_" + String(username || "admin").slice(0, 48), JSON.stringify(state), 900);
  } catch (e) {}
}

function handleVerifyAdmin_(data, nowStr) {
  var sec = getOrCreateSecurityProps_();
  var authCtx = getAuthSpreadsheet_();
  if (!authCtx.ss) return jsonError("Auth sheet unavailable");
  var sheets = ensureAdminSecuritySheets_(authCtx.ss);
  var userSheet = sheets.userSheet;
  var logSheet = sheets.logSheet;

  var username = String(data.username || "admin").trim().toLowerCase().slice(0, 64);
  var password = String(data.password || "").slice(0, 128);
  var ip = String(data.ip || "Direct Sheet Auth");
  var ua = String(data.userAgent || "");

  if (!username || !password) {
    appendLoginAudit_(logSheet, nowStr, username, "Thất bại", "Thiếu tài khoản hoặc mật khẩu", ip, ua);
    return jsonSuccess({ valid: false, reason: "invalid_credentials" });
  }

  var nowMs = Date.now();
  var bf = getBruteForceState_(username);
  if (bf.lockUntil && bf.lockUntil > nowMs) {
    var mins = Math.max(1, Math.ceil((bf.lockUntil - nowMs) / 60000));
    appendLoginAudit_(logSheet, nowStr, username, "Bị chặn", "Đang bị khóa chống dò mật khẩu (" + mins + " phút)", ip, ua);
    return jsonSuccess({ valid: false, locked: true, retryAfterMinutes: mins, reason: "locked" });
  }

  var lastRow = userSheet.getLastRow();
  if (lastRow < 3) {
    appendLoginAudit_(logSheet, nowStr, username, "Thất bại", "Chưa có tài khoản trong QuanTriVien", ip, ua);
    return jsonSuccess({ valid: false, reason: "no_password_set" });
  }

  var rows = userSheet.getRange(3, 1, lastRow - 2, 7).getValues();
  for (var i = 0; i < rows.length; i++) {
    var rowUser = String(rows[i][0] || "").trim().toLowerCase();
    if (!rowUser || rowUser !== username) continue;

    var rowRole = String(rows[i][1] || "Quản trị viên").trim();
    var rowStatus = String(rows[i][2] || "").trim().toLowerCase();
    var storedSecret = String(rows[i][3] || "").trim();

    if (rowStatus !== "hoạt động" && rowStatus !== "active") {
      appendLoginAudit_(logSheet, nowStr, username, "Bị chặn", "Tài khoản đang bị khóa trong Sheet", ip, ua);
      return jsonSuccess({ valid: false, reason: "account_locked" });
    }

    if (!storedSecret) {
      appendLoginAudit_(logSheet, nowStr, username, "Thất bại", "Chưa thiết lập mật khẩu trong QuanTriVien", ip, ua);
      return jsonSuccess({ valid: false, reason: "no_password_set" });
    }

    var matched = verifyPasswordHash_(password, storedSecret, sec.AUTH_PEPPER);
    // Tự động nâng cấp hash cũ SHA-256 sang PBKDF2-HMAC-SHA256 khi đăng nhập thành công
    if (matched && storedSecret.indexOf("baco$sha256$") === 0) {
      var upSalt = sha256Hex_(Utilities.getUuid() + ":" + Date.now()).slice(0, 24);
      userSheet.getRange(3 + i, 4).setValue(hashPasswordWithSalt_(password, upSalt, sec.AUTH_PEPPER));
      userSheet.getRange(3 + i, 7).setValue("Nâng cấp PBKDF2 lúc " + nowStr);
    }

    if (matched) {
      saveBruteForceState_(username, { fails: 0, lockUntil: 0 });
      userSheet.getRange(3 + i, 5).setValue(nowStr);
      userSheet.getRange(3 + i, 6).setValue(sanitizeSheetCell_(ip));
      appendLoginAudit_(logSheet, nowStr, username, "Thành công", "Đăng nhập hợp lệ (" + rowRole + ")", ip, ua);
      var sess = createSignedSession_(rowUser, rowRole, sec.SESSION_SIGN_KEY);
      return jsonSuccess({
        valid: true,
        username: rowUser,
        role: rowRole,
        sessionToken: sess.token,
        expiresAt: sess.expiresAt
      });
    }

    try { Utilities.sleep(450); } catch (e) {}
    bf.fails = (bf.fails || 0) + 1;
    if (bf.fails >= 5) {
      bf.lockUntil = nowMs + 15 * 60 * 1000;
      bf.fails = 0;
      saveBruteForceState_(username, bf);
      appendLoginAudit_(logSheet, nowStr, username, "Bị chặn", "Sai 5 lần liên tiếp -> khóa 15 phút", ip, ua);
      return jsonSuccess({ valid: false, locked: true, retryAfterMinutes: 15, reason: "locked" });
    }
    saveBruteForceState_(username, bf);
    appendLoginAudit_(logSheet, nowStr, username, "Thất bại", "Sai mật khẩu (lần " + bf.fails + "/5)", ip, ua);
    return jsonSuccess({ valid: false, remainingAttempts: 5 - bf.fails, reason: "wrong_password" });
  }

  try { Utilities.sleep(450); } catch (e) {}
  bf.fails = (bf.fails || 0) + 1;
  if (bf.fails >= 5) {
    bf.lockUntil = nowMs + 15 * 60 * 1000;
    bf.fails = 0;
    saveBruteForceState_(username, bf);
    appendLoginAudit_(logSheet, nowStr, username, "Bị chặn", "Dò tài khoản 5 lần -> khóa 15 phút", ip, ua);
    return jsonSuccess({ valid: false, locked: true, retryAfterMinutes: 15, reason: "locked" });
  }
  saveBruteForceState_(username, bf);
  appendLoginAudit_(logSheet, nowStr, username, "Thất bại", "Không tồn tại tài khoản", ip, ua);
  return jsonSuccess({ valid: false, remainingAttempts: 5 - bf.fails, reason: "not_found" });
}

function handleVerifySession_(data) {
  var auth = requireAdminSession_(data);
  if (!auth.ok) return jsonSuccess({ valid: false, reason: "invalid_or_expired" });
  return jsonSuccess({ valid: true, username: auth.username, role: auth.role, expiresAt: auth.sess.expiresAt });
}

function handleRefreshSession_(data) {
  var auth = requireAdminSession_(data);
  if (!auth.ok) return jsonSuccess({ valid: false, reason: "invalid_or_expired" });
  var sec = getOrCreateSecurityProps_();
  revokeSessionJti_(auth.sess.jti, auth.sess.expiresAt);
  var nextSess = createSignedSession_(auth.username, auth.role, sec.SESSION_SIGN_KEY);
  return jsonSuccess({
    valid: true,
    username: auth.username,
    role: auth.role,
    sessionToken: nextSess.token,
    expiresAt: nextSess.expiresAt
  });
}

function handleLogoutSession_(data) {
  var token = String((data && (data.sessionToken || data.token)) || "").trim();
  if (token) {
    var sec = getOrCreateSecurityProps_();
    var sess = verifySignedSession_(token, sec.SESSION_SIGN_KEY);
    if (sess) {
      revokeSessionJti_(sess.jti, sess.expiresAt);
    }
  }
  return jsonSuccess({ revoked: true });
}

function handleRevokeAllSessions_(data) {
  var auth = requireAdminSession_(data);
  if (!auth.ok) return jsonError(auth.message);
  bumpUserTokenVersion_(auth.username);
  return jsonSuccess({ revokedAll: true });
}

// Đọc toàn bộ dữ liệu quản trị qua API có xác thực (cho phép đặt Google Sheet ở chế độ Riêng tư)
function getAdminDashboardData_(ss) {
  var retail = [];
  var wholesale = [];
  var customers = [];
  var products = [];
  var siteContent = {};

  try {
    var sheet1 = ss.getSheets()[0];
    var lr1 = sheet1.getLastRow();
    if (lr1 >= 7) {
      var rows1 = sheet1.getRange("B7:L" + lr1).getValues();
      for (var i = 0; i < rows1.length; i++) {
        var r1 = rows1[i];
        var code1 = String(r1[1] || "").trim();
        var name1 = String(r1[2] || "").trim();
        if (!code1 && !name1) continue;
        retail.push({
          timestamp: String(r1[0] || ""),
          orderCode: code1.replace("#", "").trim() || ("BC" + (i + 1)),
          name: name1,
          phone: String(r1[3] || "").replace(/^'/, ""),
          address: String(r1[4] || ""),
          product: String(r1[5] || ""),
          quantity: Number(r1[6]) || 1,
          totalAmount: Number(r1[7]) || 0,
          paymentMethod: String(r1[8] || "COD"),
          note: String(r1[9] || ""),
          status: String(r1[10] || "Chờ xác nhận")
        });
      }
      retail.reverse();
    }
  } catch (e1) {}

  try {
    var wsSheet = ss.getSheetByName("Khách Sỉ & Đại Lý");
    if (wsSheet && wsSheet.getLastRow() >= 3) {
      var rowsWs = wsSheet.getRange("B3:I" + wsSheet.getLastRow()).getValues();
      for (var w = 0; w < rowsWs.length; w++) {
        var rw = rowsWs[w];
        var lCode = String(rw[1] || "").trim();
        var lName = String(rw[2] || "").trim();
        if (!lCode && !lName) continue;
        wholesale.push({
          timestamp: String(rw[0] || ""),
          leadCode: lCode || ("#DL" + (w + 1)),
          name: lName,
          phone: String(rw[3] || "").replace(/^'/, ""),
          area: String(rw[4] || ""),
          businessModel: String(rw[5] || ""),
          note: String(rw[6] || ""),
          status: String(rw[7] || "Chờ gọi tư vấn")
        });
      }
      wholesale.reverse();
    }
  } catch (e2) {}

  try {
    var custSheet = ss.getSheetByName("KhachHang");
    if (custSheet && custSheet.getLastRow() >= 3) {
      var rowsC = custSheet.getRange("A3:H" + custSheet.getLastRow()).getValues();
      for (var c = 0; c < rowsC.length; c++) {
        var rc = rowsC[c];
        var cPhone = String(rc[1] || "").replace(/^'/, "").trim();
        var cName = String(rc[0] || "").trim();
        if (!cPhone || cName.indexOf("#BC") !== -1) continue;
        customers.push({
          name: cName,
          phone: cPhone,
          address: String(rc[2] || ""),
          orderCount: Number(rc[3]) || 0,
          totalSpent: Number(rc[4]) || 0,
          lastOrderAt: String(rc[5] || ""),
          tier: String(rc[6] || "Thành viên"),
          note: String(rc[7] || "")
        });
      }
    }
  } catch (e3) {}

  try {
    var prodSheet = ss.getSheetByName("SanPham");
    if (prodSheet && prodSheet.getLastRow() >= 3) {
      var rowsP = prodSheet.getRange("A3:J" + prodSheet.getLastRow()).getValues();
      for (var p = 0; p < rowsP.length; p++) {
        var rp = rowsP[p];
        if (!rp[1]) continue;
        var st = String(rp[6] || "").toLowerCase();
        var stockV = (rp[9] === "" || rp[9] === null || rp[9] === undefined) ? (st.indexOf("hết") !== -1 ? 0 : 100) : Number(rp[9]);
        products.push({
          id: String(rp[0] || ("prod_" + (p + 1))),
          name: String(rp[1] || ""),
          price: Number(rp[2]) || 0,
          unit: String(rp[3] || "Chai 500ml"),
          category: String(rp[4] || "Mắm Nhĩ Thượng Hạng"),
          tag: String(rp[5] || ""),
          inStock: st.indexOf("hết") === -1 && stockV > 0,
          desc: String(rp[7] || ""),
          image: String(rp[8] || "./pictrure/1.jpg"),
          stock: Math.max(0, Math.floor(stockV || 0))
        });
      }
    }
  } catch (e4) {}

  try {
    var cfgSheet = ss.getSheetByName("NoiDungWeb");
    if (cfgSheet && cfgSheet.getLastRow() >= 3) {
      var rowsCfg = cfgSheet.getRange("A3:B" + cfgSheet.getLastRow()).getValues();
      for (var k = 0; k < rowsCfg.length; k++) {
        var key = String(rowsCfg[k][0] || "").trim();
        if (key) siteContent[key] = String(rowsCfg[k][1] || "");
      }
    }
  } catch (e5) {}

  return jsonSuccess({
    orders: retail,
    wholesale: wholesale,
    customers: customers,
    products: products,
    siteContent: siteContent,
    vouchers: getVouchersList_()
  });
}

function getPushSubscriptionsData_(ss) {
  var sheet = ss.getSheetByName("PushTokens");
  if (!sheet || sheet.getLastRow() < 2) return jsonSuccess({ subscriptions: [] });
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var list = [];
  for (var i = 0; i < values.length; i++) {
    var endpoint = String(values[i][1] || "").trim();
    var p256dh = String(values[i][2] || "").trim();
    var auth = String(values[i][3] || "").trim();
    if (endpoint && p256dh && auth) {
      list.push({ endpoint: endpoint, keys: { p256dh: p256dh, auth: auth } });
    }
  }
  return jsonSuccess({ subscriptions: list });
}

// Tính toán giá trị đơn hàng hoàn toàn tại backend từ SanPham & Voucher
function calculateOrderPricingServer_(ss, data) {
  var catalog = [];
  try {
    var prodSheet = ss.getSheetByName("SanPham");
    if (prodSheet && prodSheet.getLastRow() >= 3) {
      var pRows = prodSheet.getRange("A3:J" + prodSheet.getLastRow()).getValues();
      for (var i = 0; i < pRows.length; i++) {
        var pName = String(pRows[i][1] || "").trim();
        var pPrice = Number(pRows[i][2]) || 0;
        if (pName && pPrice > 0) {
          catalog.push({
            id: String(pRows[i][0] || "").trim(),
            name: pName,
            price: pPrice,
            nameLower: pName.toLowerCase()
          });
        }
      }
    }
  } catch (e) {}

  if (catalog.length === 0) {
    catalog = [
      { id: "prod_1", name: "Nước Mắm Nhĩ Thượng Hạng 43°N", price: 145000, nameLower: "nước mắm nhĩ thượng hạng 43°n" },
      { id: "prod_2", name: "Nước Mắm Truyền Thống 35°N", price: 110000, nameLower: "nước mắm truyền thống 35°n" },
      { id: "prod_3", name: "Can 2 Lít Mắm Nhĩ Đậm Đà", price: 240000, nameLower: "can 2 lít mắm nhĩ đậm đà" },
      { id: "prod_4", name: "Hộp Quà Biếu 2 Chai Thủy Tinh", price: 320000, nameLower: "hộp quà biếu 2 chai thủy tinh" }
    ];
  }

  function findCatalogProduct(idOrName) {
    var key = String(idOrName || "").trim();
    if (!key) return null;
    var keyLow = key.toLowerCase();
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].id && catalog[i].id === key) return catalog[i];
      if (catalog[i].nameLower === keyLow) return catalog[i];
    }
    for (var j = 0; j < catalog.length; j++) {
      if (keyLow.indexOf(catalog[j].nameLower) !== -1 || catalog[j].nameLower.indexOf(keyLow) !== -1) {
        return catalog[j];
      }
    }
    return null;
  }

  var parsedItems = [];
  if (Array.isArray(data.items) && data.items.length > 0) {
    for (var k = 0; k < data.items.length; k++) {
      var it = data.items[k];
      var qty = Math.min(500, Math.max(1, Math.floor(Number(it.qty || it.quantity || 1) || 1)));
      var prod = findCatalogProduct(it.id || it.name);
      if (!prod) return { ok: false, message: "Sản phẩm không hợp lệ: " + String(it.name || it.id || "") };
      parsedItems.push({ name: prod.name, price: prod.price, qty: qty });
    }
  } else {
    var rawProdStr = String(data.product || "").trim();
    if (!rawProdStr) return { ok: false, message: "Thiếu thông tin sản phẩm đặt hàng." };
    var parts = rawProdStr.split(",");
    for (var pIdx = 0; pIdx < parts.length; pIdx++) {
      var part = String(parts[pIdx] || "").trim();
      if (!part) continue;
      var m = part.match(/^(.*?)\s*\(x(\d+)\)\s*$/i);
      var pNamePart = m ? m[1].trim() : part;
      var pQtyPart = m ? Math.min(500, Math.max(1, parseInt(m[2], 10) || 1)) : Math.min(500, Math.max(1, Math.floor(Number(data.quantity) || 1)));
      var foundP = findCatalogProduct(pNamePart);
      if (!foundP) return { ok: false, message: "Không tìm thấy sản phẩm trong bảng giá: " + pNamePart };
      parsedItems.push({ name: foundP.name, price: foundP.price, qty: pQtyPart });
    }
  }

  if (parsedItems.length === 0) {
    return { ok: false, message: "Giỏ hàng trống hoặc sản phẩm không hợp lệ." };
  }

  var subtotal = 0;
  var totalQty = 0;
  var summaryParts = [];
  for (var idx = 0; idx < parsedItems.length; idx++) {
    subtotal += parsedItems[idx].price * parsedItems[idx].qty;
    totalQty += parsedItems[idx].qty;
    summaryParts.push(parsedItems[idx].name + " (x" + parsedItems[idx].qty + ")");
  }

  var discountAmount = 0;
  var freeShipping = false;
  var appliedVoucherCode = "";
  var vCode = String(data.voucherCode || "").trim().toUpperCase();
  if (vCode) {
    var vList = getVouchersList_();
    for (var vi = 0; vi < vList.length; vi++) {
      var v = vList[vi];
      if (v.code === vCode && v.active && (v.minOrder <= 0 || subtotal >= v.minOrder)) {
        appliedVoucherCode = v.code;
        if (v.type === "freeship") {
          freeShipping = true;
        } else if (v.type === "percent") {
          discountAmount = Math.round((subtotal * v.value) / 100);
          if (v.maxDiscount > 0 && discountAmount > v.maxDiscount) discountAmount = v.maxDiscount;
        } else {
          discountAmount = Math.min(v.value, subtotal);
        }
        break;
      }
    }
  }

  var shippingFee = (totalQty >= 2 || subtotal >= 250000 || freeShipping || totalQty === 0) ? 0 : 30000;
  var totalAmount = Math.max(0, subtotal - discountAmount) + shippingFee;
  if (totalAmount <= 0) return { ok: false, message: "Giá trị đơn hàng không hợp lệ." };

  return {
    ok: true,
    subtotal: subtotal,
    discountAmount: discountAmount,
    shippingFee: shippingFee,
    totalAmount: totalAmount,
    totalQty: totalQty,
    voucherCode: appliedVoucherCode,
    productSummary: summaryParts.join(", ")
  };
}

// Tự động mã hóa PBKDF2 ngay khi người quản trị nhập mật khẩu mới vào cột D tab QuanTriVien
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== "QuanTriVien") return;
    if (e.range.getRow() >= 3 && e.range.getColumn() === 4) {
      var val = String(e.value || "").trim();
      if (val && val.indexOf("baco$pbkdf2$") !== 0 && val.indexOf("baco$sha256$") !== 0) {
        var sec = getOrCreateSecurityProps_();
        var salt = sha256Hex_(Utilities.getUuid() + ":" + Date.now()).slice(0, 24);
        e.range.setValue(hashPasswordWithSalt_(val, salt, sec.AUTH_PEPPER));
        sheet.getRange(e.range.getRow(), 7).setValue("Đã tự mã hóa PBKDF2 lúc " + new Date().toLocaleString("vi-VN"));
      }
    }
  } catch (err) {}
}

// Menu thao tác nhanh ngay trên thanh công cụ Google Sheets
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("🔐 Bảo Mật Ba Cô")
      .addItem("1. Khởi tạo Bảng Tài Khoản & Nhật Ký", "khoiTaoBaoMatQuanTri")
      .addItem("2. Đặt / Đổi Mật Khẩu Admin", "moHopThoaiDatMatKhau")
      .addItem("3. Mã hóa mật khẩu vừa gõ trong Sheet", "chayMaHoaMatKhauUI")
      .addItem("4. Gắn File Sheet Riêng Tư (Tùy chọn)", "moHopThoaiDatSheetRiengTu")
      .addToUi();
  } catch (e) {}
}

function moHopThoaiDatMatKhau() {
  var ui = SpreadsheetApp.getUi();
  var uRes = ui.prompt("Đặt / Đổi Mật Khẩu Quản Trị", "Nhập tên đăng nhập (mặc định: admin):", ui.ButtonSet.OK_CANCEL);
  if (uRes.getSelectedButton() !== ui.Button.OK) return;
  var uname = String(uRes.getResponseText() || "admin").trim().toLowerCase() || "admin";
  var pRes = ui.prompt("Nhập Mật Khẩu Mới cho '" + uname + "'", "Nên dùng ít nhất 8–12 ký tự (sẽ được tự động băm SHA-256):", ui.ButtonSet.OK_CANCEL);
  if (pRes.getSelectedButton() !== ui.Button.OK) return;
  var pw = String(pRes.getResponseText() || "");
  if (pw.length < 6) {
    ui.alert("Mật khẩu phải có ít nhất 6 ký tự.");
    return;
  }
  datMatKhauQuanTri(uname, pw);
  ui.alert("✅ Đã lưu & mã hóa mật khẩu cho tài khoản '" + uname + "' thành công!");
}

function chayMaHoaMatKhauUI() {
  var count = maHoaTatCaMatKhauSheet();
  SpreadsheetApp.getUi().alert("✅ Đã mã hóa an toàn " + count + " dòng mật khẩu trong tab QuanTriVien.");
}

function moHopThoaiDatSheetRiengTu() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt("Gắn Google Sheet Riêng Tư (Tùy chọn nâng cao)", "Dán Spreadsheet ID của file Sheet chỉ mình bạn có quyền xem (để trống nếu dùng chung file hiện tại):", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var id = String(res.getResponseText() || "").trim();
  var props = PropertiesService.getScriptProperties();
  if (id) {
    props.setProperty("AUTH_SPREADSHEET_ID", id);
    var ctx = getAuthSpreadsheet_();
    if (ctx.ss) ensureAdminSecuritySheets_(ctx.ss);
    ui.alert("✅ Đã chuyển dữ liệu đăng nhập sang Sheet riêng tư: " + id);
  } else {
    props.deleteProperty("AUTH_SPREADSHEET_ID");
    ui.alert("ℹ️ Đã chuyển về dùng tab QuanTriVien trong file Sheet chính.");
  }
}

// ========================================================
// TRA CỨU ĐƠN HÀNG CÔNG KHAI (MÃ ĐƠN CHÍNH XÁC + SĐT + CHE PII)
// ========================================================
function lookupOrderInSheet_(orderCodeRaw, phoneRaw) {
  var code = chuanHoa(orderCodeRaw);
  var phoneDigits = String(phoneRaw || "").replace(/\D/g, "");
  if (!code || code.length < 5 || phoneDigits.length < 4) {
    return jsonError("Vui lòng nhập đầy đủ mã đơn hàng và tối thiểu 4 số cuối điện thoại.");
  }

  var ss = layBangTinh();
  if (!ss) return jsonError("Không kết nối được bảng tính.");
  var sheet = ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return jsonSuccess({ found: false });

  var rows = sheet.getRange("B3:L" + lastRow).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    var rCode = chuanHoa(rows[i][1]);
    var rPhone = String(rows[i][3] || "").replace(/\D/g, "");
    var codeMatch = (rCode && rCode === code);
    var phoneMatch = rPhone && (rPhone === phoneDigits || rPhone.slice(-4) === phoneDigits.slice(-4));
    if (codeMatch && phoneMatch) {
      var maskedPhone = rPhone.length >= 7
        ? rPhone.slice(0, 3) + "****" + rPhone.slice(-3)
        : "****" + rPhone.slice(-3);
      var rawName = String(rows[i][2] || "").trim();
      var nameParts = rawName.split(/\s+/);
      var maskedName = nameParts.length > 1
        ? nameParts[0] + " *** " + nameParts[nameParts.length - 1]
        : (rawName.slice(0, 2) + "***");
      var rawAddr = String(rows[i][4] || "").trim();
      var addrParts = rawAddr.split(",");
      var maskedAddr = addrParts.length >= 2
        ? "***, " + addrParts.slice(-2).join(",").trim()
        : "*** (Đã ẩn địa chỉ chi tiết để bảo mật)";

      return jsonSuccess({
        found: true,
        order: {
          createdAt: String(rows[i][0] || ""),
          orderCode: String(rows[i][1] || ""),
          name: maskedName,
          phoneMasked: maskedPhone,
          address: maskedAddr,
          product: String(rows[i][5] || ""),
          quantity: Number(rows[i][6]) || 1,
          totalAmount: Number(rows[i][7]) || 0,
          paymentMethod: String(rows[i][8] || "COD"),
          status: String(rows[i][10] || "Chờ xác nhận")
        }
      });
    }
  }
  return jsonSuccess({ found: false });
}

// ========================================================
// HỆ THỐNG MÃ GIẢM GIÁ (VOUCHER TAB & VALIDATION)
// ========================================================
function getDefaultVouchers_() {
  return [
    { code: "BACO20", type: "fixed", value: 20000, minOrder: 200000, maxDiscount: 20000, active: true, note: "Giảm 20.000đ cho đơn từ 200k" },
    { code: "FREESHIP", type: "freeship", value: 30000, minOrder: 0, maxDiscount: 30000, active: true, note: "Miễn phí vận chuyển toàn quốc" },
    { code: "VIP10", type: "percent", value: 10, minOrder: 350000, maxDiscount: 50000, active: true, note: "Giảm 10% tối đa 50.000đ đơn từ 350k" }
  ];
}

function getVouchersList_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache ? cache.get("baco_vouchers_v1") : null;
    if (cached) return JSON.parse(cached);
  } catch (ce) {}

  var ss = layBangTinh();
  if (!ss) return getDefaultVouchers_();
  var vSheet = ss.getSheetByName("Voucher");
  if (!vSheet || vSheet.getLastRow() < 3) return getDefaultVouchers_();

  var rows = vSheet.getRange(3, 1, vSheet.getLastRow() - 2, 7).getValues();
  var list = [];
  for (var i = 0; i < rows.length; i++) {
    var code = String(rows[i][0] || "").trim().toUpperCase();
    if (!code) continue;
    list.push({
      code: code,
      type: String(rows[i][1] || "fixed").trim(),
      value: Number(rows[i][2]) || 0,
      minOrder: Number(rows[i][3]) || 0,
      maxDiscount: Number(rows[i][4]) || 0,
      active: String(rows[i][5] || "").toLowerCase().indexOf("tắt") === -1,
      note: String(rows[i][6] || "")
    });
  }
  if (list.length === 0) list = getDefaultVouchers_();
  try {
    var cache2 = CacheService.getScriptCache();
    if (cache2) cache2.put("baco_vouchers_v1", JSON.stringify(list), 120);
  } catch (ce2) {}
  return list;
}

function handleVerifyVoucher_(codeRaw, subtotal) {
  var code = String(codeRaw || "").trim().toUpperCase();
  if (!code) return jsonSuccess({ valid: false, message: "Vui lòng nhập mã giảm giá." });

  var list = getVouchersList_();
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].code === code) { found = list[i]; break; }
  }
  if (!found || !found.active) {
    return jsonSuccess({ valid: false, message: "Mã giảm giá không tồn tại hoặc đã hết hạn." });
  }
  if (found.minOrder > 0 && subtotal < found.minOrder) {
    return jsonSuccess({
      valid: false,
      message: "Mã " + code + " áp dụng cho đơn từ " + found.minOrder.toLocaleString("vi-VN") + "đ."
    });
  }

  var discountAmount = 0;
  var freeShipping = false;
  if (found.type === "freeship") {
    freeShipping = true;
    discountAmount = 0;
  } else if (found.type === "percent") {
    discountAmount = Math.round((subtotal * found.value) / 100);
    if (found.maxDiscount > 0 && discountAmount > found.maxDiscount) {
      discountAmount = found.maxDiscount;
    }
  } else {
    discountAmount = Math.min(found.value, subtotal);
  }

  return jsonSuccess({
    valid: true,
    voucher: {
      code: found.code,
      type: found.type,
      value: found.value,
      discountAmount: discountAmount,
      freeShipping: freeShipping,
      note: found.note
    }
  });
}

function khoiTaoBangVoucher(sheet) {
  sheet.getRange("A1:G1").merge()
    .setValue("🏷️ KHO MÃ GIẢM GIÁ & KHUYẾN MÃI — NƯỚC MẮM BA CÔ")
    .setBackground("#1e3a8a").setFontColor("#ffffff").setFontWeight("bold").setFontSize(12)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 34);

  var headers = ["Mã Voucher", "Loại (fixed/percent/freeship)", "Giá trị giảm", "Đơn tối thiểu", "Giảm tối đa", "Trạng thái", "Ghi chú hiển thị"];
  sheet.getRange(2, 1, 1, headers.length).setValues([headers])
    .setBackground("#0f172a").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
  sheet.setRowHeight(2, 28);
  sheet.setFrozenRows(2);
}

function dinhDangDongVoucher(sheet, row, isActive) {
  sheet.getRange(row, 1, 1, 7).setVerticalAlignment("middle").setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(row, 3, 1, 3).setNumberFormat("#,##0");
  sheet.getRange(row, 6).setBackground(isActive ? "#dcfce7" : "#fee2e2").setFontColor(isActive ? "#166534" : "#991b1b").setFontWeight("bold").setHorizontalAlignment("center");
}



