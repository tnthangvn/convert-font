# new requiment

* sau khi import .woff field "font name"
** define 1 key lưu vào local storage nếu chưa có thì lấ default là tên của file vừa import vào eg: RV-Icon.woff -> RV-Icon
** field "Sync Path" ví dụ sau khi import vào từ /home/pc/Desktop/RV-Icon.woff thì lấy path làm giá trị default

* thêm 1 field là sync css dưới field "Sync Path"
** giá trị define 1 key vào local storage nếu chưa có thì lấ y default là folder ngang cấp với "Sync Path" + "icon.css"

* key define vào localStorage sẽ theo rule này ví dụ
** /home/pc/Desktop/RV-Icon.woff -> sync-path-[toSlug(RV-Icon.woff)]
** field sync-path-[toSlug(RV-Icon.woff)]-icon