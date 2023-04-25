# encode.py
import datetime
import jwt # import jwt library
SECRET_KEY = "test123"
# json data to encode
json_data = {
  "roles": ["moderator:firstboard","viewer:hboard"]
}
encode_data = jwt.encode(payload=json_data, \
                        key=SECRET_KEY, algorithm="HS256")
print(encode_data) 